-- Reverses the earlier "walk-ins are collected instantly" design: walk-in
-- orders now start as 'Received', same as preorders, and staff explicitly
-- tap "mark collected" once the drink is actually handed over. The stamp
-- (and any reward redemption) now happens at that moment too, not at
-- order-creation time — mark_order_collected() already works for any
-- order regardless of order_type since it only looks at status, so it
-- picks up walk-ins for free; it just needs to also read the redeemed
-- flag off the order's own items now that log_walkin_order() no longer
-- touches stamps at all. Stock booking stays at order-creation time —
-- that's about committing ingredients, unrelated to handover timing.
create or replace function log_walkin_order(
  p_id text, p_name text, p_phone text, p_items jsonb, p_total numeric, p_notes text
) returns void
language plpgsql
as $$
declare
  li jsonb;
  v_item_id text;
  v_qty integer;
  v_limit integer;
  v_sold integer;
  v_redeemed boolean;
  v_current_stamps integer;
begin
  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      select walkin_limit, walkin_sold into v_limit, v_sold from items where id = v_item_id;
      if v_limit is not null and v_sold + v_qty > v_limit then
        raise exception 'Not enough walk-in stock left for %', li->>'name';
      end if;
    end if;
  end loop;

  -- Still fail fast here if staff try to redeem for an ineligible
  -- customer, even though the actual deduction happens on collection.
  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(p_items) li;

  if v_redeemed then
    if p_phone is null or p_phone = '' then
      raise exception 'A phone number is required to redeem a free drink';
    end if;
    select stamps into v_current_stamps from customers where phone = p_phone;
    if v_current_stamps is null or v_current_stamps < 8 then
      raise exception 'This customer does not have enough stamps for a free drink';
    end if;
  end if;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, p_total, p_notes, 'Received', 'walkin');

  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      update items set walkin_sold = walkin_sold + v_qty where id = v_item_id;
    end if;
  end loop;
end;
$$;

create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
  v_items jsonb;
  v_redeemed boolean;
begin
  select phone, name, status, items into v_phone, v_name, v_status, v_items from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now() where id = p_id;

  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + 1 - (case when v_redeemed then 8 else 0 end),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), 1);
    end if;
  end if;
end;
$$;
