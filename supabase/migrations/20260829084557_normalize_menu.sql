-- Replaces the single `menu.data jsonb` blob with real relational tables.
--
-- Before: every menu edit (even toggling one item sold-out) read and
-- rewrote the ENTIRE catalog as one JSON document — no DB constraints,
-- no indexed per-item lookups, no safe concurrent edits (two staff
-- editing different items could clobber each other), and sales
-- reporting grouped by item *name* string-matching instead of a stable
-- id. This migrates existing data into normalized tables and drops the
-- old table. orders.items stays jsonb on purpose — it's a point-in-time
-- receipt snapshot, not a live catalog.

create table if not exists categories (
  id text primary key,
  name text not null unique,
  sort_order integer not null default 0
);

create table if not exists items (
  id text primary key,
  category_id text not null references categories(id) on delete cascade,
  name text not null,
  "desc" text not null default '',
  price numeric not null default 0,
  iced boolean not null default false,
  soldout boolean not null default false,
  icon text,
  photo text,
  sort_order integer not null default 0
);
create index if not exists items_category_id_idx on items(category_id);

create table if not exists item_milks (
  item_id text not null references items(id) on delete cascade,
  id text not null,
  name text not null,
  price numeric not null default 0,
  sort_order integer not null default 0,
  primary key (item_id, id)
);

create table if not exists item_toppings (
  item_id text not null references items(id) on delete cascade,
  id text not null,
  name text not null,
  price numeric not null default 0,
  sort_order integer not null default 0,
  primary key (item_id, id)
);

create table if not exists item_sugar_levels (
  item_id text not null references items(id) on delete cascade,
  level text not null,
  sort_order integer not null default 0,
  primary key (item_id, sort_order)
);

-- ---------------------------------------------------------------
-- One-time backfill from the old menu.data jsonb blob, if it exists.
-- ---------------------------------------------------------------
do $$
declare
  old_data jsonb;
  cat_key text;
  cat_id text;
  cat_sort integer := 0;
  item jsonb;
  item_sort integer;
begin
  if not exists (select 1 from information_schema.tables where table_name = 'menu') then
    return;
  end if;
  select data into old_data from menu where id = 'main';
  if old_data is null then
    return;
  end if;

  for cat_key in select jsonb_object_keys(old_data->'categories') loop
    cat_id := 'cat_' || md5(cat_key);
    insert into categories (id, name, sort_order) values (cat_id, cat_key, cat_sort)
      on conflict (id) do nothing;
    cat_sort := cat_sort + 1;

    item_sort := 0;
    for item in select * from jsonb_array_elements(old_data->'categories'->cat_key) loop
      insert into items (id, category_id, name, "desc", price, iced, soldout, icon, photo, sort_order)
        values (
          item->>'id', cat_id, item->>'name', coalesce(item->>'desc', ''),
          coalesce((item->>'price')::numeric, 0), coalesce((item->>'iced')::boolean, false),
          coalesce((item->>'soldout')::boolean, false), item->>'icon', item->>'photo', item_sort
        )
        on conflict (id) do nothing;
      item_sort := item_sort + 1;

      insert into item_milks (item_id, id, name, price, sort_order)
        select item->>'id', m->>'id', m->>'name', coalesce((m->>'price')::numeric, 0), ord - 1
        from jsonb_array_elements(coalesce(item->'milks', '[]'::jsonb)) with ordinality as t(m, ord)
        on conflict (item_id, id) do nothing;

      insert into item_toppings (item_id, id, name, price, sort_order)
        select item->>'id', tp->>'id', tp->>'name', coalesce((tp->>'price')::numeric, 0), ord - 1
        from jsonb_array_elements(coalesce(item->'toppings', '[]'::jsonb)) with ordinality as t(tp, ord)
        on conflict (item_id, id) do nothing;

      insert into item_sugar_levels (item_id, level, sort_order)
        select item->>'id', s.value #>> '{}', ord - 1
        from jsonb_array_elements(coalesce(item->'sugarLevels', '[]'::jsonb)) with ordinality as s(value, ord)
        on conflict (item_id, sort_order) do nothing;
    end loop;
  end loop;

  drop table menu;
end $$;

-- ---------------------------------------------------------------
-- get_menu(): reassembles the same {categories: {name: [items...]}}
-- shape the frontend already expects, in one round trip — so nothing
-- in src/components/ has to change, only how store.jsx fetches it.
-- ---------------------------------------------------------------
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
            'iced', it.iced, 'soldout', it.soldout, 'icon', it.icon, 'photo', it.photo,
            'milks', coalesce(mk.milks, '[]'::jsonb),
            'toppings', coalesce(tp.toppings, '[]'::jsonb),
            'sugarLevels', coalesce(sg.levels, '[]'::jsonb)
          ) order by it.sort_order
        ) filter (where it.id is not null),
        '[]'::jsonb
      ) as items
    from categories c
    left join items it on it.category_id = c.id
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price) order by m.sort_order) as milks
      from item_milks m where m.item_id = it.id
    ) mk on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'price', t.price) order by t.sort_order) as toppings
      from item_toppings t where t.item_id = it.id
    ) tp on true
    left join lateral (
      select jsonb_agg(s.level order by s.sort_order) as levels
      from item_sugar_levels s where s.item_id = it.id
    ) sg on true
    group by c.id, c.name, c.sort_order
  ) cat;
$$;

-- ---------------------------------------------------------------
-- save_menu_item(): one round trip for the admin item editor —
-- resolves/creates the category by name, upserts the item, and
-- replaces its milk/topping/sugar-level rows. Everything a single
-- edit touches happens in one transaction instead of the old
-- "read the whole tree client-side, mutate it, write the whole
-- tree back" pattern.
-- ---------------------------------------------------------------
create or replace function save_menu_item(
  p_id text, p_category text, p_name text, p_desc text, p_price numeric,
  p_iced boolean, p_photo text, p_icon text,
  p_milks jsonb, p_toppings jsonb, p_sugar_levels jsonb
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
      iced = p_iced, photo = p_photo, icon = p_icon
      where id = p_id;
  else
    select coalesce(max(sort_order), -1) + 1 into v_next_sort from items where category_id = v_category_id;
    insert into items (id, category_id, name, "desc", price, iced, soldout, photo, icon, sort_order)
      values (p_id, v_category_id, p_name, p_desc, p_price, p_iced, false, p_photo, p_icon, v_next_sort);
  end if;

  delete from item_milks where item_id = p_id;
  insert into item_milks (item_id, id, name, price, sort_order)
    select p_id, mk->>'id', mk->>'name', coalesce((mk->>'price')::numeric, 0), ord - 1
    from jsonb_array_elements(p_milks) with ordinality as t(mk, ord);

  delete from item_toppings where item_id = p_id;
  insert into item_toppings (item_id, id, name, price, sort_order)
    select p_id, tp->>'id', tp->>'name', coalesce((tp->>'price')::numeric, 0), ord - 1
    from jsonb_array_elements(p_toppings) with ordinality as t(tp, ord);

  delete from item_sugar_levels where item_id = p_id;
  insert into item_sugar_levels (item_id, level, sort_order)
    select p_id, sg #>> '{}', ord - 1
    from jsonb_array_elements(p_sugar_levels) with ordinality as t(sg, ord);
end;
$$;

alter table categories enable row level security;
alter table items enable row level security;
alter table item_milks enable row level security;
alter table item_toppings enable row level security;
alter table item_sugar_levels enable row level security;

-- Same permissive trade-off as the rest of this project's tables (see
-- supabase-schema.sql) — the staff dashboard uses the anon key too,
-- since there's no real Supabase Auth yet.
drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories for select using (true);
drop policy if exists "public write categories" on categories;
create policy "public write categories" on categories for all using (true) with check (true);

drop policy if exists "public read items" on items;
create policy "public read items" on items for select using (true);
drop policy if exists "public write items" on items;
create policy "public write items" on items for all using (true) with check (true);

drop policy if exists "public read item_milks" on item_milks;
create policy "public read item_milks" on item_milks for select using (true);
drop policy if exists "public write item_milks" on item_milks;
create policy "public write item_milks" on item_milks for all using (true) with check (true);

drop policy if exists "public read item_toppings" on item_toppings;
create policy "public read item_toppings" on item_toppings for select using (true);
drop policy if exists "public write item_toppings" on item_toppings;
create policy "public write item_toppings" on item_toppings for all using (true) with check (true);

drop policy if exists "public read item_sugar_levels" on item_sugar_levels;
create policy "public read item_sugar_levels" on item_sugar_levels for select using (true);
drop policy if exists "public write item_sugar_levels" on item_sugar_levels;
create policy "public write item_sugar_levels" on item_sugar_levels for all using (true) with check (true);

grant execute on function get_menu() to anon;
grant execute on function save_menu_item(text, text, text, text, numeric, boolean, text, text, jsonb, jsonb, jsonb) to anon;
