-- Records which staff member collected, refunded, or deleted each order.
-- Every signed-in staff account currently has identical, indistinguishable
-- access — RLS only ever checks "is this caller authenticated", never
-- which specific user — so once more than one staff member shares the
-- dashboard there's no way to tell who actually did what.
--
-- auth.email() reads the caller's own identity off their JWT for the
-- current request. mark_order_collected/refund_order/delete_order are all
-- invoker-rights (not security definer), called via sb.rpc(...) using the
-- signed-in staff member's own session — so auth.email() resolves to
-- whoever is actually clicking the button, without the client having to
-- (and being trusted to) say who they are.
--
-- collected_by/refunded_by live directly on the order, right next to
-- collected_at/refunded_at, so OrderDetailSheet can show them with no
-- join. A deleted order stops existing, so there's nowhere on the row
-- itself to record who deleted it — order_deletions is a small append-only
-- log written just before the row is removed, for later lookup if needed.

alter table orders add column if not exists collected_by text;
alter table orders add column if not exists refunded_by text;

create table if not exists order_deletions (
  id bigint generated always as identity primary key,
  order_id text not null,
  order_snapshot jsonb not null,
  deleted_by text,
  deleted_at timestamptz not null default now()
);

-- "for all", not just select — delete_order() itself needs to INSERT here
-- (as the calling staff member, since the function is invoker-rights), not
-- only read it back afterwards.
alter table order_deletions enable row level security;
drop policy if exists "staff read order_deletions" on order_deletions;
drop policy if exists "staff all order_deletions" on order_deletions;
create policy "staff all order_deletions" on order_deletions for all to authenticated using (true) with check (true);

create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
  v_items jsonb;
  v_redeemed boolean;
begin
  select phone, name, status, items into v_phone, v_name, v_status, v_items from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now(), collected_by = auth.email() where id = p_id;

  select coalesce(bool_or(coalesce((li->>'redeemed')::boolean, false)), false) into v_redeemed
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + 1 - (case when v_redeemed then 8 else 0 end),
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
  v_redeemed boolean;
  li jsonb;
  v_item_id text;
  v_qty integer;
begin
  select status, order_type, phone, items into v_status, v_order_type, v_phone, v_items
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

  if v_status = 'Collected' and v_phone is not null and v_phone <> '' then
    select coalesce(bool_or(coalesce((it->>'redeemed')::boolean, false)), false) into v_redeemed
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    update customers set
      stamps = greatest(stamps - 1 + (case when v_redeemed then 8 else 0 end), 0),
      updated_at = now()
    where phone = v_phone;
  end if;
end;
$$;

-- Replaces the plain `sb.from('orders').delete()` the admin dashboard used
-- to call directly — that had no way to record who or what was deleted.
create or replace function delete_order(p_id text)
returns void
language plpgsql
as $$
declare
  v_order jsonb;
begin
  select to_jsonb(o) into v_order from orders o where o.id = p_id;
  if v_order is null then
    raise exception 'Order not found';
  end if;
  insert into order_deletions (order_id, order_snapshot, deleted_by) values (p_id, v_order, auth.email());
  delete from orders where id = p_id;
end;
$$;

-- Explicit even though ALTER DEFAULT PRIVILEGES already covers new public
-- functions for `authenticated` — RLS on `orders` ("staff all orders", to
-- authenticated) is the actual gate here, same as refund_order.
grant execute on function delete_order(text) to authenticated;
