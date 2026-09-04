-- Redeeming a free drink online (redeem-order edge function) inserted the
-- $0 order directly with a plain `.from('orders').insert(...)` and never
-- touched customers.stamps at all. The comment on mark_order_collected
-- says the loyalty stamp is only awarded once staff mark a preorder
-- "Collected" — but that logic only ever *adds* the +1 for the order
-- itself; nothing ever *subtracts* the 8 stamps a redemption costs when
-- the order came in already fully covered ($0) rather than paid through
-- Stripe. In practice that meant:
--   * a customer's stamp card kept showing 8/8 (or whatever it was)
--     immediately after "redeeming" a free drink, instead of dropping to 0
--   * redeem-order's eligibility check re-reads customers.stamps fresh on
--     every call, so nothing stopped the same customer redeeming a second,
--     third, ... free drink before staff ever marked the first one
--     collected, since the count never moved
--
-- Fix: fold the whole redemption into one atomic, row-locked function
-- (place_redeemed_order) that deducts the 8 stamps at the moment the
-- order is placed, not when it's later collected — mirroring how
-- log_walkin_order already deducts immediately for a walk-in redemption
-- (walk-ins are "Collected" at creation, so for them "placed" and
-- "collected" are the same moment anyway). "select ... for update" locks
-- the customer row so a second concurrent redemption attempt blocks until
-- the first commits and then correctly sees the reduced count.
--
-- mark_order_collected and refund_order both need a matching adjustment
-- so this doesn't get double-counted (or lost) later:
--   * mark_order_collected must NOT subtract another 8 when the order
--     already had it deducted at placement — total = 0 reliably identifies
--     that case, since create-checkout-session refuses a $0 cart entirely
--     (a fully-redeemed cart is routed to redeem-order instead — see its
--     own comment) and a walk-in never reaches this function (it's
--     already 'Collected' at insert).
--   * refund_order previously only ever reversed stamps for an order that
--     had reached 'Collected' (nothing happened at 'Received' before this
--     fix). Now a still-'Received' $0 redeemed order already has its -8
--     applied, so refunding it before it's ever collected needs to hand
--     those 8 stamps back.

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

  select stamps into v_stamps from customers
    where phone = p_phone and access_token is not null and access_token = p_token
    for update;
  if v_stamps is null or v_stamps < 8 then
    raise exception 'not_eligible';
  end if;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, 0, p_notes, 'Received', 'preorder');

  update customers set stamps = stamps - 8, updated_at = now() where phone = p_phone;

  perform record_preorder_sale(p_items);

  return jsonb_build_object('id', p_id, 'items', p_items, 'total', 0, 'status', 'Received');
end;
$$;

grant execute on function place_redeemed_order(text, text, text, text, jsonb, text) to service_role;

create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
  v_items jsonb;
  v_total numeric;
  v_redeemed boolean;
begin
  select phone, name, status, items, total into v_phone, v_name, v_status, v_items, v_total from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now(), collected_by = auth.email() where id = p_id;

  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        -- total = 0 means this was a redeem-order redemption, which
        -- already took its 8 stamps at placement (place_redeemed_order) —
        -- only a paid order with a redeemed line (total > 0, via Stripe)
        -- still owes that deduction here.
        stamps = stamps + 1 - (case when v_redeemed and v_total <> 0 then 8 else 0 end),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), 1);
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
  v_redeemed boolean;
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
    select coalesce(bool_or(coalesce((it->>'redeemed')::boolean, false)), false) into v_redeemed
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    if v_status = 'Collected' then
      update customers set
        stamps = greatest(stamps - 1 + (case when v_redeemed then 8 else 0 end), 0),
        updated_at = now()
      where phone = v_phone;
    elsif v_status = 'Received' and v_redeemed and v_total = 0 then
      -- place_redeemed_order deducted its 8 stamps immediately at
      -- placement rather than waiting for collection — undo that.
      update customers set stamps = stamps + 8, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;
