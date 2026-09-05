-- Corrects a regression from the previous migration
-- (20260905120000_redeem_order_stamp_deduction.sql): it made
-- mark_order_collected/refund_order skip the -8 stamp deduction whenever
-- `total = 0`, on the assumption that meant the order came through the
-- new place_redeemed_order() (which now deducts at placement instead of
-- collection). But total = 0 isn't unique to that path — a walk-in order
-- that's entirely the free drink (staff logs 1 unit, marks it redeemed,
-- nothing else in the order) also has total = 0, and log_walkin_order()
-- never deducts anything at placement (see walkin_manual_collect.sql —
-- walk-ins reach 'Received' first and are deducted at collection same as
-- preorders). Gating on total alone would let a walk-in customer redeem a
-- free drink and keep their 8 stamps.
--
-- Fix: gate on order_type = 'preorder' AND total = 0 instead — that
-- combination is unique to place_redeemed_order (create-checkout-session
-- refuses a $0 cart outright, and log_walkin_order always writes
-- order_type = 'walkin').

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
  v_redeemed boolean;
  v_already_deducted boolean;
begin
  select phone, name, status, order_type, items, total
    into v_phone, v_name, v_status, v_order_type, v_items, v_total
  from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now(), collected_by = auth.email() where id = p_id;

  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  -- Only place_redeemed_order's $0 online redemption deducts stamps at
  -- placement — that's order_type = 'preorder' with total = 0 specifically
  -- (a walk-in redeeming for free also has total = 0, but never deducts
  -- until collection, so it still owes the -8 here).
  v_already_deducted := (v_order_type = 'preorder' and v_total = 0);

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + 1 - (case when v_redeemed and not v_already_deducted then 8 else 0 end),
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
    elsif v_status = 'Received' and v_redeemed and v_total = 0 and v_order_type = 'preorder' then
      -- place_redeemed_order deducted its 8 stamps immediately at
      -- placement rather than waiting for collection — undo that. A
      -- walk-in order never reaches here (it doesn't deduct until
      -- collection), so it correctly falls through with no stamp change.
      update customers set stamps = stamps + 8, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;
