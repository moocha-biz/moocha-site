-- Walk-in orders only ever supported marking a single unit free per order,
-- and log_walkin_order's eligibility check only looked at the customer's
-- already-banked stamps. A big walk-in order can cross STAMP_GOAL on its
-- own (e.g. 12 drinks from a customer with 0 prior stamps earns a free
-- one), the same way the online cart already computes eligibility as
-- floor((banked stamps + cart qty) / STAMP_GOAL) — see store.jsx's
-- totalFreeUnits. Staff were never offered a free drink on a walk-in
-- order unless the customer already had 8+ stamps from previous visits.
--
-- mark_order_collected/refund_order already sum freeQty across an order's
-- items (20260907090000_stamps_multi_redeem.sql) and defer the actual
-- stamp deduction/award to collection time either way, so only
-- log_walkin_order's pre-check needs updating: it now allows (and
-- validates) more than one free unit per order, using the same
-- (stamps + qty) formula as the online cart.

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
  v_free_qty integer;
  v_total_qty integer;
  v_current_stamps integer;
  v_max_free integer;
begin
  for li in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
    order by (value->>'itemId')
  loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      -- Locks the row so a concurrent walk-in order for the same item can't
      -- pass this check against the same stale walkin_sold.
      select walkin_limit, walkin_sold into v_limit, v_sold from items where id = v_item_id for update;
      if v_limit is not null and v_sold + v_qty > v_limit then
        raise exception 'Not enough walk-in stock left for %', li->>'name';
      end if;
    end if;
  end loop;

  -- Aliased "it", not "li" — "li" is already this function's loop variable
  -- above, and reusing it as a FROM-clause alias makes every "li" reference
  -- in this query ambiguous between the two.
  select
    coalesce(sum(case when coalesce((it->>'redeemed')::boolean, false) then coalesce((it->>'freeQty')::integer, 1) else 0 end), 0),
    coalesce(sum(coalesce((it->>'qty')::integer, 0)), 0)
    into v_free_qty, v_total_qty
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it;

  if v_free_qty > 0 then
    if p_phone is null or p_phone = '' then
      raise exception 'A phone number is required to redeem a free drink';
    end if;
    select stamps into v_current_stamps from customers where phone = p_phone for update;
    v_current_stamps := coalesce(v_current_stamps, 0);
    v_max_free := least(floor((v_current_stamps + v_total_qty)::numeric / 8)::integer, v_total_qty);
    if v_free_qty > v_max_free then
      raise exception 'This customer does not have enough stamps for a free drink';
    end if;
  end if;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, p_total, p_notes, 'Received', 'walkin');

  for li in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      update items set walkin_sold = walkin_sold + v_qty where id = v_item_id;
    end if;
  end loop;
end;
$$;

grant execute on function log_walkin_order(text, text, text, jsonb, numeric, text) to anon;
