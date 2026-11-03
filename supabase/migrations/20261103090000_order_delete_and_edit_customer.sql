-- Deleting an order used to only remove the orders row. The customer that
-- mark_order_collected created for it (and the stamps it awarded) stayed
-- behind, so a walk-in keyed in with a mistyped phone number left a stray
-- customer holding stamps nobody earned, even after the order was deleted.
--
-- Three pieces:
--   * order_stamp_delta(): the net stamps an order has applied to its
--     phone's balance right now, using the same bookkeeping as
--     mark_order_collected / place_redeemed_order / refund_order.
--   * delete_order(): reverses that delta before removing the order, then
--     drops the customer if nothing is left of them.
--   * update_order_customer(): fixes a mistyped name/phone in place. The
--     order's stamps move from the old number to the new one, and the old
--     customer is dropped if nothing is left of them.

create or replace function order_stamp_delta(p_status text, p_order_type text, p_total numeric, p_items jsonb)
returns integer
language sql
immutable
as $$
  with q as (
    select
      coalesce(sum(case when coalesce((li->>'redeemed')::boolean, false)
        then coalesce((li->>'freeQty')::integer, 1) else 0 end), 0)::integer as free_qty,
      coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0)::integer as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) li
  )
  select case
    -- Collected: earned a stamp per paid drink, paid 7 per free one
    -- (a $0 preorder paid its 7 up front, the rest at collection — same net).
    when p_status = 'Collected' then (qty - free_qty) - 7 * free_qty
    -- Uncollected $0 preorder: place_redeemed_order already took the 7s.
    when p_status in ('Received', 'Preparing', 'Ready')
      and p_order_type = 'preorder' and p_total = 0 then -7 * free_qty
    -- Everything else (uncollected paid orders, refunded, payment failed)
    -- hasn't moved the balance.
    else 0
  end
  from q;
$$;

-- A customer row with no orders, no stamps and no Telegram link carries
-- nothing worth keeping — it's what a mistyped number leaves behind once
-- its only order is deleted or moved. (An access_token alone protects
-- nothing once there are no orders or stamps behind it.)
create or replace function prune_orphan_customer(p_phone text)
returns void
language sql
as $$
  delete from customers c
  where c.phone = p_phone
    and coalesce(c.stamps, 0) = 0
    and c.telegram_chat_id is null
    and not exists (select 1 from orders o where o.phone = p_phone);
$$;

create or replace function delete_order(p_id text)
returns void
language plpgsql
as $$
declare
  v_row orders%rowtype;
  v_delta integer;
begin
  select * into v_row from orders where id = p_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  insert into order_deletions (order_id, order_snapshot, deleted_by)
    values (p_id, to_jsonb(v_row), auth.email());

  v_delta := order_stamp_delta(v_row.status, v_row.order_type, v_row.total, v_row.items);
  if v_row.phone is not null and v_row.phone <> '' and v_delta <> 0 then
    update customers set stamps = greatest(stamps - v_delta, 0), updated_at = now()
    where phone = v_row.phone;
  end if;

  delete from orders where id = p_id;

  if v_row.phone is not null and v_row.phone <> '' then
    perform prune_orphan_customer(v_row.phone);
  end if;
end;
$$;

create or replace function update_order_customer(p_id text, p_name text, p_phone text)
returns void
language plpgsql
as $$
declare
  v_row orders%rowtype;
  v_old text;
  v_new text := coalesce(nullif(trim(p_phone), ''), '');
  v_name text := coalesce(trim(p_name), '');
  v_delta integer;
begin
  select * into v_row from orders where id = p_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  v_old := coalesce(v_row.phone, '');

  if v_new = v_old then
    update orders set name = v_name where id = p_id;
    if v_row.status = 'Collected' and v_new <> '' and v_name <> '' then
      update customers set name = v_name, updated_at = now() where phone = v_new;
    end if;
    return;
  end if;

  v_delta := order_stamp_delta(v_row.status, v_row.order_type, v_row.total, v_row.items);

  -- An uncollected free-drink preorder was paid for with the old number's
  -- stamps (proved with that customer's own access token), so moving it
  -- would hand the new number a drink its card never paid for.
  if v_row.status <> 'Collected' and v_delta <> 0 then
    raise exception 'This order was paid with stamps - its phone number can''t be changed';
  end if;

  if v_old <> '' and v_delta <> 0 then
    update customers set stamps = greatest(stamps - v_delta, 0), updated_at = now()
    where phone = v_old;
  end if;

  update orders set name = v_name, phone = v_new where id = p_id;

  -- Mirrors mark_order_collected: a collected order always leaves its
  -- customer on file; an uncollected one gets its customer at collection.
  if v_new <> '' and v_row.status = 'Collected' then
    if exists (select 1 from customers where phone = v_new) then
      update customers set
        stamps = greatest(stamps + v_delta, 0),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_new;
    else
      insert into customers (phone, name, stamps) values (v_new, v_name, greatest(v_delta, 0));
    end if;
  end if;

  if v_old <> '' then
    perform prune_orphan_customer(v_old);
  end if;
end;
$$;

-- Invoker-rights like delete_order/refund_order — RLS on orders/customers
-- ("staff all ...", to authenticated) is the actual gate.
revoke execute on function prune_orphan_customer(text) from public, anon;
revoke execute on function update_order_customer(text, text, text) from public, anon;
grant execute on function order_stamp_delta(text, text, numeric, jsonb) to authenticated;
grant execute on function prune_orphan_customer(text) to authenticated;
grant execute on function update_order_customer(text, text, text) to authenticated;
grant execute on function delete_order(text) to authenticated;
