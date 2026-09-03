-- Adds: a collection-hours window admins set per sale week (customers see
-- when to pick up), per-item stock caps split by order_type ('preorder'
-- vs 'walkin'), and the "mark collected" step — a loyalty stamp is now
-- only awarded when an order is actually collected, not at payment time.
-- Preorder stock is booked in the Stripe webhook right after payment;
-- walk-in stock is booked by log_walkin_order(), used by a new admin
-- order-builder. Both counters reset to 0 whenever admin sets a new
-- collection window (set_collection_hours), which is what "resets each
-- week" means here — there's no separate manual reset step.

alter table settings add column if not exists collection_start timestamptz;
alter table settings add column if not exists collection_end timestamptz;

alter table items add column if not exists preorder_limit integer;
alter table items add column if not exists walkin_limit integer;
alter table items add column if not exists preorder_sold integer not null default 0;
alter table items add column if not exists walkin_sold integer not null default 0;

alter table orders add column if not exists order_type text not null default 'preorder';
alter table orders drop constraint if exists orders_order_type_check;
alter table orders add constraint orders_order_type_check check (order_type in ('preorder', 'walkin'));

create or replace function get_menu()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('categories', coalesce(jsonb_object_agg(cat.name, cat.items order by cat.sort_order), '{}'::jsonb))
  from (
    select c.id, c.name, c.sort_order,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', it.id, 'name', it.name, 'desc', it."desc", 'price', it.price,
            'iced', it.iced, 'soldout', it.soldout, 'photo', it.photo,
            'isHidden', coalesce(it.is_hidden, false),
            'preorderLimit', it.preorder_limit, 'preorderSold', it.preorder_sold,
            'walkinLimit', it.walkin_limit, 'walkinSold', it.walkin_sold,
            'sugarLevels', coalesce(sg.levels, '[]'::jsonb)
          ) order by it.id
        ) filter (where it.id is not null),
        '[]'::jsonb
      ) as items
    from categories c
    left join items it on it.category_id = c.id
    left join lateral (
      select jsonb_agg(s.level order by s.sort_order) as levels
      from item_sugar_levels s where s.item_id = it.id
    ) sg on true
    group by c.id, c.name, c.sort_order
  ) cat;
$$;

create or replace function save_menu_item(
  p_id text, p_category text, p_name text, p_desc text, p_price numeric,
  p_iced boolean, p_photo text, p_sugar_levels jsonb,
  p_preorder_limit integer, p_walkin_limit integer
) returns void
language plpgsql
as $$
declare
  v_category_id text;
  v_next_sort integer;
begin
  select id into v_category_id from categories where name = p_category;
  if v_category_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_next_sort from categories;
    v_category_id := 'cat_' || md5(p_category || clock_timestamp()::text);
    insert into categories (id, name, sort_order) values (v_category_id, p_category, v_next_sort);
  end if;

  if exists (select 1 from items where id = p_id) then
    update items set category_id = v_category_id, name = p_name, "desc" = p_desc, price = p_price,
      iced = p_iced, photo = p_photo, preorder_limit = p_preorder_limit, walkin_limit = p_walkin_limit
      where id = p_id;
  else
    insert into items (id, category_id, name, "desc", price, iced, soldout, photo, is_hidden, preorder_limit, walkin_limit)
      values (p_id, v_category_id, p_name, p_desc, p_price, p_iced, false, p_photo, false, p_preorder_limit, p_walkin_limit);
  end if;

  delete from item_sugar_levels where item_id = p_id;
  insert into item_sugar_levels (item_id, level, sort_order)
    select p_id, sg #>> '{}', ord - 1
    from jsonb_array_elements(p_sugar_levels) with ordinality as t(sg, ord);
end;
$$;

-- Admin sets the collection window for the upcoming sale; this is also
-- the "new week" signal that resets both stock counters to 0.
create or replace function set_collection_hours(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
as $$
begin
  update settings set collection_start = p_start, collection_end = p_end where id = 'main';
  -- `where true`: this intentionally touches every row, but Supabase's
  -- safeupdate extension rejects any UPDATE with no WHERE clause at all,
  -- even inside a function body — this satisfies it without narrowing it.
  update items set preorder_sold = 0, walkin_sold = 0 where true;
end;
$$;

-- Called by the Stripe webhook right after a paid preorder is inserted.
-- The order is already paid, so this only books stock against the
-- counter — it never blocks or rejects.
create or replace function record_preorder_sale(p_items jsonb)
returns void
language plpgsql
as $$
declare
  li jsonb;
begin
  for li in select * from jsonb_array_elements(p_items) loop
    if (li->>'itemId') is not null then
      update items set preorder_sold = preorder_sold + coalesce((li->>'qty')::integer, 0) where id = (li->>'itemId');
    end if;
  end loop;
end;
$$;

-- Admin's walk-in order builder. Unlike preorders, nothing has been paid
-- yet at this point, so this checks walk-in stock and rejects (raises)
-- before writing anything if any line would go over.
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
begin
  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      select walkin_limit, walkin_sold into v_limit, v_sold from items where id = v_item_id;
      if v_limit is not null and v_sold + v_qty > v_limit then
        raise exception 'Not enough walk-in stock left for %', li->>'name';
      end if;
    end if;
  end loop;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type)
    values (p_id, p_name, p_phone, now(), p_items, p_total, p_notes, 'Collected', 'walkin');

  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      update items set walkin_sold = walkin_sold + v_qty where id = v_item_id;
    end if;
  end loop;

  if p_phone is not null and p_phone <> '' then
    if exists (select 1 from customers where phone = p_phone) then
      update customers set stamps = stamps + 1, name = coalesce(nullif(p_name, ''), name), updated_at = now() where phone = p_phone;
    else
      insert into customers (phone, name, stamps) values (p_phone, coalesce(p_name, ''), 1);
    end if;
  end if;
end;
$$;

-- Admin taps "mark collected" on a preorder; this is the only place a
-- preorder's loyalty stamp is now awarded (walk-ins get theirs
-- immediately in log_walkin_order, since they're collected on the spot).
-- Idempotent: a second call on an already-collected order is a no-op, so
-- a retried request can't double-stamp.
create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
begin
  select phone, name, status into v_phone, v_name, v_status from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected' where id = p_id;

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set stamps = stamps + 1, name = coalesce(nullif(v_name, ''), name), updated_at = now() where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), 1);
    end if;
  end if;
end;
$$;

grant execute on function get_menu() to anon;
grant execute on function save_menu_item(text, text, text, text, numeric, boolean, text, jsonb, integer, integer) to anon;
grant execute on function set_collection_hours(timestamptz, timestamptz) to anon;
grant execute on function log_walkin_order(text, text, text, jsonb, numeric, text) to anon;
grant execute on function mark_order_collected(text) to anon;
grant execute on function record_preorder_sale(jsonb) to anon, service_role;
