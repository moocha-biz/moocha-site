-- A cart that crosses a multiple of STAMP_GOAL on its own — e.g. buying 8
-- drinks in one order with 0 prior stamps, or 16 in one go overflowing onto
-- a second card — now has the corresponding drink(s) marked free right in
-- that same order (create-checkout-session/redeem-order pick the cheapest
-- unit(s) automatically; see their own comments). That means an order can
-- carry more than one free unit, and even a single line can have more than
-- one of its own units free — a line's redeemed unit count now travels as
-- `freeQty` (defaulting to 1 when a line has `redeemed: true` but no
-- `freeQty`, which covers every order written before this migration and
-- the walk-in flow, which still only ever marks exactly 1 unit free).
--
-- place_redeemed_order, mark_order_collected, and refund_order all
-- previously assumed at most one redeemed unit per order (a flat -8/+8).
-- All three now sum freeQty across an order's items instead, and
-- deduct/restore STAMP_GOAL per free unit rather than a flat STAMP_GOAL
-- once.

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
begin
  -- Retried request for an orderId already written (double-tap, network
  -- hiccup) — hand back what's there instead of re-checking eligibility
  -- or deducting stamps a second time.
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

  perform record_preorder_sale(p_items);

  return jsonb_build_object('id', p_id, 'items', p_items, 'total', 0, 'status', 'Received');
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
  v_order_type text;
  v_items jsonb;
  v_total numeric;
  v_free_qty integer;
  v_already_deducted boolean;
  v_earned integer;
begin
  select phone, name, status, order_type, items, total
    into v_phone, v_name, v_status, v_order_type, v_items, v_total
  from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now(), collected_by = auth.email() where id = p_id;

  select
    coalesce(sum(
      case when coalesce((li->>'redeemed')::boolean, false)
        then coalesce((li->>'freeQty')::integer, 1)
        else 0
      end
    ), 0),
    coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0)
      - coalesce(sum(
          case when coalesce((li->>'redeemed')::boolean, false)
            then coalesce((li->>'freeQty')::integer, 1)
            else 0
          end
        ), 0)
    into v_free_qty, v_earned
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  -- Only place_redeemed_order's $0 online redemption deducts stamps at
  -- placement — that's order_type = 'preorder' with total = 0 specifically
  -- (a walk-in redeeming for free also has total = 0, but never deducts
  -- until collection, so it still owes the deduction here).
  v_already_deducted := (v_order_type = 'preorder' and v_total = 0);

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + v_earned - (case when not v_already_deducted then 8 * v_free_qty else 0 end),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), greatest(v_earned, 0));
    end if;
  end if;
end;
$$;

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
  from orders where id = p_id;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status not in ('Received', 'Collected') then
    raise exception 'Only a received or collected order can be refunded (this one is %)', v_status;
  end if;

  update orders set status = 'Refunded', refunded_at = now(), refunded_by = auth.email(), refund_id = p_refund_id
  where id = p_id;

  for li in select * from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      if v_order_type = 'walkin' then
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
        stamps = greatest(stamps - v_earned + 8 * v_free_qty, 0),
        updated_at = now()
      where phone = v_phone;
    elsif v_status = 'Received' and v_free_qty > 0 and v_total = 0 and v_order_type = 'preorder' then
      -- place_redeemed_order deducted its stamps immediately at placement
      -- rather than waiting for collection — undo that. A walk-in order
      -- never reaches here (it doesn't deduct until collection), so it
      -- correctly falls through with no stamp change.
      update customers set stamps = stamps + 8 * v_free_qty, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;
