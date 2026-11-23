-- Lets staff change one drink on an uncollected order to a different one
-- (e.g. Hojicha Latte -> Miso Hojicha Latte at the counter) and have the
-- customer just top up the price difference, instead of refunding the
-- whole order and ringing up a new one.
--
-- Works the same for a preorder changed at the stall and a walk-in changed
-- before it's handed over:
--   * One paid unit of the chosen line becomes one unit of the new drink,
--     priced from the items table (never from the client).
--   * orders.total moves by the difference, so sales/revenue include the
--     top-up. Each change is logged in orders.item_changes (from, to,
--     amount, who, when); the Stripe charge itself is total minus the sum
--     of those amounts.
--   * Stock: the old drink goes back to whichever pool it came from. The
--     new drink is made at the stall, so it always comes out of walk-in
--     stock (and respects walkin_limit). A preorder line taken from walk-in
--     stock is tagged stockPool = 'walkin' so refund_order puts it back in
--     the right pool.
--   * Stamps: the drink count doesn't change, so neither do stamps. Free
--     (stamp-redeemed) units can't be changed — only paid ones.

alter table orders add column if not exists item_changes jsonb not null default '[]'::jsonb;

create or replace function swap_order_item(p_id text, p_line_index integer, p_new_item_id text, p_new_sugar text)
returns jsonb
language plpgsql
as $$
declare
  v_row orders%rowtype;
  v_items jsonb;
  v_line jsonb;
  v_qty integer;
  v_free integer;
  v_paid integer;
  v_old_unit numeric;
  v_old_pool text;
  v_new_pool text := 'walkin';
  v_new record;
  v_diff numeric;
  v_out jsonb := '[]'::jsonb;
  v_merged boolean := false;
  v_sugar text := nullif(trim(coalesce(p_new_sugar, '')), '');
  li jsonb;
  i integer := 0;
begin
  select * into v_row from orders where id = p_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_row.status not in ('Received', 'Preparing', 'Ready') then
    raise exception 'Only an order that hasn''t been collected yet can be changed';
  end if;

  v_items := coalesce(v_row.items, '[]'::jsonb);
  if p_line_index is null or p_line_index < 0 or p_line_index >= jsonb_array_length(v_items) then
    raise exception 'That item is no longer on this order';
  end if;
  v_line := v_items->p_line_index;
  v_qty := coalesce((v_line->>'qty')::integer, 0);
  v_free := case when coalesce((v_line->>'redeemed')::boolean, false)
    then coalesce((v_line->>'freeQty')::integer, 1) else 0 end;
  v_paid := v_qty - v_free;
  if v_paid < 1 then
    raise exception 'A free (stamp) drink can''t be changed';
  end if;
  v_old_unit := round(coalesce((v_line->>'lineTotal')::numeric, 0) / v_paid, 2);
  v_old_pool := coalesce(v_line->>'stockPool', v_row.order_type);

  select id, name, price, soldout, walkin_limit, walkin_sold into v_new
  from items where id = p_new_item_id for update;
  if not found then
    raise exception 'That drink is no longer on the menu';
  end if;
  if v_new.soldout then
    raise exception '% is sold out', v_new.name;
  end if;
  if v_new.id = v_line->>'itemId' and coalesce(v_sugar, '') = coalesce(v_line->>'sugar', '') then
    raise exception 'Pick a different drink or sugar level';
  end if;

  -- Same drink, different sugar only: no stock moves at all.
  if v_new.id <> coalesce(v_line->>'itemId', '') then
    if v_new.walkin_limit is not null and v_new.walkin_sold + 1 > v_new.walkin_limit then
      raise exception 'No walk-in stock left for %', v_new.name;
    end if;
    update items set walkin_sold = walkin_sold + 1 where id = v_new.id;
    if v_line->>'itemId' is not null then
      if v_old_pool = 'walkin' then
        update items set walkin_sold = greatest(walkin_sold - 1, 0) where id = v_line->>'itemId';
      else
        update items set preorder_sold = greatest(preorder_sold - 1, 0) where id = v_line->>'itemId';
      end if;
    end if;
  else
    v_new_pool := v_old_pool;
  end if;

  v_diff := v_new.price - v_old_unit;
  -- A $0 preorder means "paid with stamps up front" everywhere else
  -- (mark_order_collected, order_stamp_delta), so a paid order mustn't
  -- land on exactly $0.
  if v_row.total + v_diff <= 0 then
    raise exception 'This change would leave the order at $0 - refund it instead';
  end if;

  -- Rebuild the item list: the old line loses one paid unit (dropped if
  -- that was its last), and the new drink merges into a matching paid-for
  -- line from the same stock pool if there is one, else goes on the end.
  for li in select value from jsonb_array_elements(v_items) as t(value) loop
    if i = p_line_index then
      if v_qty > 1 then
        v_out := v_out || jsonb_build_array(li || jsonb_build_object(
          'qty', v_qty - 1,
          'lineTotal', round(coalesce((li->>'lineTotal')::numeric, 0) - v_old_unit, 2)));
      end if;
    elsif not v_merged
      and li->>'itemId' = v_new.id
      and coalesce(li->>'sugar', '') = coalesce(v_sugar, '')
      and coalesce(li->>'stockPool', v_row.order_type) = v_new_pool
      and not coalesce((li->>'redeemed')::boolean, false) then
      v_out := v_out || jsonb_build_array(li || jsonb_build_object(
        'qty', coalesce((li->>'qty')::integer, 0) + 1,
        'lineTotal', round(coalesce((li->>'lineTotal')::numeric, 0) + v_new.price, 2)));
      v_merged := true;
    else
      v_out := v_out || jsonb_build_array(li);
    end if;
    i := i + 1;
  end loop;

  if not v_merged then
    v_out := v_out || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'itemId', v_new.id, 'name', v_new.name, 'sugar', v_sugar, 'qty', 1, 'lineTotal', v_new.price,
        'stockPool', case when v_new_pool <> v_row.order_type then v_new_pool end)));
  end if;

  update orders set
    items = v_out,
    total = round(total + v_diff, 2),
    item_changes = item_changes || jsonb_build_object(
      'from', concat_ws(' · ', v_line->>'name', v_line->>'sugar'),
      'to', concat_ws(' · ', v_new.name, v_sugar),
      'amount', v_diff,
      'changedBy', auth.email(),
      'changedAt', now())
  where id = p_id;

  return jsonb_build_object('amount', v_diff);
end;
$$;

-- Same as 20261001090000_stamps_buy7_get1.sql's refund_order, except a
-- line's stock goes back to its own stockPool when it has one (a preorder
-- drink swapped at the stall came out of walk-in stock).
create or replace function refund_order(p_id text, p_refund_id text default null)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_order_type text;
  v_phone text;
  v_items jsonb;
  v_total numeric;
  v_free_qty integer;
  v_earned integer;
  li jsonb;
  v_item_id text;
  v_qty integer;
begin
  select status, order_type, phone, items, total into v_status, v_order_type, v_phone, v_items, v_total
  from orders where id = p_id
  for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status not in ('Received', 'Preparing', 'Ready', 'Collected') then
    raise exception 'Only a received, preparing, ready, or collected order can be refunded (this one is %)', v_status;
  end if;

  update orders set status = 'Refunded', refunded_at = now(), refunded_by = auth.email(), refund_id = p_refund_id
  where id = p_id;

  for li in select * from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      if coalesce(li->>'stockPool', v_order_type) = 'walkin' then
        update items set walkin_sold = greatest(walkin_sold - v_qty, 0) where id = v_item_id;
      else
        update items set preorder_sold = greatest(preorder_sold - v_qty, 0) where id = v_item_id;
      end if;
    end if;
  end loop;

  if v_phone is not null and v_phone <> '' then
    select
      coalesce(sum(
        case when coalesce((it->>'redeemed')::boolean, false)
          then coalesce((it->>'freeQty')::integer, 1)
          else 0
        end
      ), 0),
      coalesce(sum(coalesce((it->>'qty')::integer, 0)), 0)
        - coalesce(sum(
            case when coalesce((it->>'redeemed')::boolean, false)
              then coalesce((it->>'freeQty')::integer, 1)
              else 0
            end
          ), 0)
      into v_free_qty, v_earned
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    if v_status = 'Collected' then
      update customers set
        stamps = greatest(stamps - v_earned + 7 * v_free_qty, 0),
        updated_at = now()
      where phone = v_phone;
    elsif v_status in ('Received', 'Preparing', 'Ready') and v_free_qty > 0 and v_total = 0 and v_order_type = 'preorder' then
      update customers set stamps = stamps + 7 * v_free_qty, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;

-- Invoker-rights like refund_order/update_order_customer — RLS on orders
-- and items (staff-only writes) is the actual gate.
revoke execute on function swap_order_item(text, integer, text, text) from public, anon;
grant execute on function swap_order_item(text, integer, text, text) to authenticated;
