-- Fixes two concurrency gaps found in the stock-booking functions:
--
-- 1. log_walkin_order checked walkin_limit/walkin_sold with a plain SELECT,
--    then wrote the new total later. Two concurrent walk-in orders for the
--    same low-stock item (two staff devices, or a double-tap) could both
--    read the same stale walkin_sold, both pass the limit check, and both
--    get booked — oversold stock with nothing paid yet, and nothing that
--    would ever have to be refunded to catch it. Fixed by locking each
--    item row (`for update`) before checking, so a second concurrent call
--    for the same item blocks until the first one's transaction commits
--    and sees the up-to-date count. Items are locked in a consistent
--    (sorted by id) order across the function so two orders sharing
--    multiple items can't deadlock each other.
--
-- 2. record_preorder_sale (called from the Stripe webhook once a preorder
--    is actually paid) never re-checked preorder_limit at all — it just
--    unconditionally incremented preorder_sold. create-checkout-session
--    only checks the limit before payment, and PayNow settlement is async
--    (can take minutes), so enough concurrent checkouts for the last few
--    units of an item can all pass that check, all get paid, and all get
--    booked here with no re-validation. Since the money's already been
--    captured by this point, rejecting the booking isn't an option (that
--    would silently lose track of a paid order) — instead this now locks
--    the item row, and if a booking pushes preorder_sold past
--    preorder_limit, it's recorded on the order itself (new
--    orders.stock_alert column) so staff can see it in the admin orders
--    list and follow up (refund/contact the customer) instead of it going
--    unnoticed.

alter table orders add column if not exists stock_alert text;

drop function if exists record_preorder_sale(jsonb);
create function record_preorder_sale(p_items jsonb)
returns jsonb
language plpgsql
as $$
declare
  li jsonb;
  v_item_id text;
  v_qty integer;
  v_limit integer;
  v_name text;
  v_new_sold integer;
  v_alerts jsonb := '[]'::jsonb;
begin
  for li in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
    order by (value->>'itemId')
  loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      -- Locks the row so a concurrent booking for the same item can't read
      -- a stale preorder_sold before this one commits.
      select preorder_limit, name into v_limit, v_name from items where id = v_item_id for update;
      update items set preorder_sold = preorder_sold + v_qty where id = v_item_id
        returning preorder_sold into v_new_sold;
      if v_limit is not null and v_new_sold > v_limit then
        v_alerts := v_alerts || jsonb_build_object(
          'itemId', v_item_id, 'name', v_name, 'limit', v_limit, 'sold', v_new_sold
        );
      end if;
    end if;
  end loop;
  return v_alerts;
end;
$$;

grant execute on function record_preorder_sale(jsonb) to anon, service_role;

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

  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) li;

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
  if v_stamps is null or v_free_qty <= 0 or v_stamps < 8 * v_free_qty then
    raise exception 'not_eligible';
  end if;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, 0, p_notes, 'Received', 'preorder');

  update customers set stamps = stamps - 8 * v_free_qty, updated_at = now() where phone = p_phone;

  select record_preorder_sale(p_items) into v_alerts;
  if v_alerts is not null and jsonb_array_length(v_alerts) > 0 then
    update orders set stock_alert = v_alerts::text where id = p_id;
  end if;

  return jsonb_build_object('id', p_id, 'items', p_items, 'total', 0, 'status', 'Received');
end;
$$;

grant execute on function place_redeemed_order(text, text, text, text, jsonb, text) to service_role;
