-- Stamps for a free drink in a paid (Stripe) or walk-in order only come
-- off when staff mark that order collected (mark_order_collected) — that
-- stays. But until then nothing reserved them: create-checkout-session,
-- place_redeemed_order and log_walkin_order all read the raw
-- customers.stamps balance, so a customer with 7 stamps could place one
-- order with a free drink, then another, then another before collecting
-- any of them, each getting a free drink off the same 7 stamps. The
-- greatest(..., 0) clamp in mark_order_collected then hid the shortfall.
--
-- stamps_on_hold() is what those uncollected orders will deduct at
-- collection — exactly the orders mark_order_collected hasn't already
-- deducted for (everything except a $0 preorder, which
-- place_redeemed_order deducted up front). Every place that hands out a
-- free drink now spends stamps - stamps_on_hold, so the same stamps can
-- only be promised once. The banked balance itself (and so the stamp card)
-- doesn't change until collection, same as before.

create or replace function stamps_on_hold(p_phone text)
returns integer
language sql
stable
set search_path = public
as $$
  select 7 * coalesce(sum(
    case when coalesce((li->>'redeemed')::boolean, false)
      then coalesce((li->>'freeQty')::integer, 1)
      else 0
    end
  ), 0)::integer
  from orders o, jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) li
  where p_phone is not null and p_phone <> ''
    and o.phone = p_phone
    and o.status in ('Received', 'Preparing', 'Ready')
    and not coalesce(o.order_type = 'preorder' and o.total = 0, false);
$$;
revoke execute on function stamps_on_hold(text) from public, anon;
grant execute on function stamps_on_hold(text) to authenticated, service_role;

-- The customer's own view of it, gated on the same phone + access_token
-- proof as get_my_stamps — the cart uses it so it never shows a free drink
-- the server would then refuse.
create or replace function get_my_stamps_on_hold(p_phone text, p_token text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (
    select 1 from customers
    where phone = p_phone and access_token is not null and access_token = p_token
  ) then stamps_on_hold(p_phone) else 0 end;
$$;
grant execute on function get_my_stamps_on_hold(text, text) to anon, authenticated;

create or replace function place_redeemed_order(
  p_id text, p_name text, p_phone text, p_token text, p_items jsonb, p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_stamps integer;
  v_free_qty integer;
  v_alerts jsonb;
begin
  select id, items, total, status into v_existing from orders where id = p_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id, 'items', v_existing.items, 'total', v_existing.total, 'status', v_existing.status
    );
  end if;

  select coalesce(sum(
    case when coalesce((li->>'redeemed')::boolean, false)
      then coalesce((li->>'freeQty')::integer, 1)
      else 0
    end
  ), 0) into v_free_qty
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) li;

  select stamps into v_stamps from customers
    where phone = p_phone and access_token is not null and access_token = p_token
    for update;
  -- Stamps already promised to another uncollected order's free drink
  -- aren't spendable again (see stamps_on_hold above).
  if v_stamps is null or v_free_qty <= 0 or v_stamps - stamps_on_hold(p_phone) < 7 * v_free_qty then
    raise exception 'not_eligible';
  end if;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, 0, p_notes, 'Received', 'preorder');

  update customers set stamps = stamps - 7 * v_free_qty, updated_at = now() where phone = p_phone;

  select record_preorder_sale(p_items) into v_alerts;
  if v_alerts is not null and jsonb_array_length(v_alerts) > 0 then
    update orders set stock_alert = v_alerts::text where id = p_id;
  end if;

  return jsonb_build_object('id', p_id, 'items', p_items, 'total', 0, 'status', 'Received');
end;
$$;

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
    -- Minus whatever another uncollected order's free drink already holds.
    v_current_stamps := greatest(coalesce(v_current_stamps, 0) - stamps_on_hold(p_phone), 0);
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
