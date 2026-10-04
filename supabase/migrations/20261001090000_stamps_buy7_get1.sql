-- The reward is "buy 7, the 8th's on us": the 8th drink on a card is the
-- free one. The online cart, create-checkout-session and log_walkin_order
-- already decide how many units are free that way —
-- floor((banked stamps + qty in this order) / 8) — but the places that
-- move stamps were still charging a full 8 per free unit, i.e. "bank 8,
-- the 9th is free". The two rules disagreed:
--
--   * 7 stamps + 1 drink in the cart: the cart showed it free and routed to
--     place_redeemed_order, which then refused it (7 < 8).
--   * 0 stamps + 8 drinks in one paid order: 1 free, and collecting it left
--     the customer at 0 + 7 - 8 = -1 stamps.
--
-- Bookkeeping from here on: every paid drink earns a stamp, the free drink
-- earns none and costs STAMP_GOAL - 1 = 7 stamps (the 7 paid drinks that
-- filled the card). That's the same arithmetic as the cart's formula, so
-- the balance always lands back on what a physical card would show (0
-- after redeeming a full card) and never dips below zero.
--
-- Also adds a row lock to mark_order_collected: two concurrent collects of
-- the same order (double-tap, two staff devices) could both read the
-- pre-collect status and both award stamps — the same race
-- 20260913120000_fix_mark_order_ready_race.sql fixed for mark_order_ready.

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
  if v_stamps is null or v_free_qty <= 0 or v_stamps < 7 * v_free_qty then
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
  from orders where id = p_id
  for update;
  if v_status not in ('Received', 'Preparing', 'Ready') then
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

  v_already_deducted := (v_order_type = 'preorder' and v_total = 0);

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = greatest(stamps + v_earned - (case when not v_already_deducted then 7 * v_free_qty else 0 end), 0),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_phone;
    else
      -- A brand-new customer can still have a free unit here (a big
      -- enough walk-in order crosses the card on its own), so the
      -- deduction applies to them too.
      insert into customers (phone, name, stamps)
        values (v_phone, coalesce(v_name, ''), greatest(v_earned - 7 * v_free_qty, 0));
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
        stamps = greatest(stamps - v_earned + 7 * v_free_qty, 0),
        updated_at = now()
      where phone = v_phone;
    elsif v_status in ('Received', 'Preparing', 'Ready') and v_free_qty > 0 and v_total = 0 and v_order_type = 'preorder' then
      update customers set stamps = stamps + 7 * v_free_qty, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;
