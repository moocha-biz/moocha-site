-- Stamps were awarded flat +1 per order regardless of how many drinks it
-- contained, so a 4-drink order earned the same single stamp as a 1-drink
-- order. Switch to awarding one stamp per drink actually paid for.
--
-- Each order line already carries `qty` (units of that item), and a
-- redeemed line's qty includes the 1 free unit bundled in (see
-- redeem-order/WalkinOrderSheet: paidQty = qty - 1 for a redeemed line).
-- So "stamps earned" = sum(qty) across all lines, minus 1 for the free
-- unit on a redeemed line (there is at most one redeemed line per order).
-- mark_order_collected and refund_order both compute and apply/reverse
-- that same total instead of the old flat 1, everything else (the
-- separate -8/+8 reward-redemption deduction) is unchanged.

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
    coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false),
    coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0)
      - coalesce(sum(case when coalesce((li->>'redeemed')::boolean, false) then 1 else 0 end), 0)
    into v_redeemed, v_earned
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  -- Only place_redeemed_order's $0 online redemption deducts stamps at
  -- placement — that's order_type = 'preorder' with total = 0 specifically
  -- (a walk-in redeeming for free also has total = 0, but never deducts
  -- until collection, so it still owes the -8 here).
  v_already_deducted := (v_order_type = 'preorder' and v_total = 0);

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + v_earned - (case when v_redeemed and not v_already_deducted then 8 else 0 end),
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
  v_redeemed boolean;
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
      coalesce(bool_or(coalesce((it->>'redeemed')::boolean, false)), false),
      coalesce(sum(coalesce((it->>'qty')::integer, 0)), 0)
        - coalesce(sum(case when coalesce((it->>'redeemed')::boolean, false) then 1 else 0 end), 0)
      into v_redeemed, v_earned
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    if v_status = 'Collected' then
      update customers set
        stamps = greatest(stamps - v_earned + (case when v_redeemed then 8 else 0 end), 0),
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
