-- Lets staff mark one item in a walk-in order as the customer's reward
-- redemption (walk-in only — Stripe can't process a $0 checkout, so
-- preorder redemption isn't supported). The frontend flags the redeemed
-- line with "redeemed": true inside p_items; this function re-validates
-- eligibility server-side (never trust the client for something that
-- gives away a drink) and swaps the usual +1 stamp for a -8 deduction.
--
-- STAMP_GOAL is 8 in src/data/defaults.js — keep this in sync if that
-- ever changes.
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

  insert into orders (id, name, phone, date, items, total, notes, status, order_type, collected_at)
    values (p_id, p_name, p_phone, now(), p_items, p_total, p_notes, 'Collected', 'walkin', now());

  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      update items set walkin_sold = walkin_sold + v_qty where id = v_item_id;
    end if;
  end loop;

  if p_phone is not null and p_phone <> '' then
    if exists (select 1 from customers where phone = p_phone) then
      update customers set
        stamps = stamps + 1 - (case when v_redeemed then 8 else 0 end),
        name = coalesce(nullif(p_name, ''), name), updated_at = now()
      where phone = p_phone;
    else
      insert into customers (phone, name, stamps) values (p_phone, coalesce(p_name, ''), 1);
    end if;
  end if;
end;
$$;
