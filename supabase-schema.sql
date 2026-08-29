-- Moocha — Supabase schema
-- Run this once in your Supabase project's SQL editor (SQL Editor > New query > Run).

-- needed for password hashing (crypt / gen_salt) — Supabase keeps this
-- in a separate "extensions" schema, so every call below is written as
-- extensions.crypt(...) / extensions.gen_salt(...) to find it reliably.
create extension if not exists pgcrypto with schema extensions;

create table if not exists settings (
  id text primary key default 'main',
  payment_enabled boolean not null default true,
  stall_phone text not null default '+6596586775',
  stall_name text not null default 'Moocha'
);
insert into settings (id) values ('main') on conflict (id) do nothing;

-- The menu is real relational tables, not a single jsonb blob — every
-- edit used to read+rewrite the entire catalog as one JSON document.
-- get_menu() below reassembles the same {categories: {name: [items]}}
-- shape the frontend expects, so no component code needs to know.
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

insert into categories (id, name, sort_order) values
  ('cat_matcha', 'Matcha Drinks', 0),
  ('cat_seasonal', 'Seasonal Bakes', 1)
on conflict (id) do nothing;

insert into items (id, category_id, name, "desc", price, iced, soldout, icon, photo, sort_order) values
  ('m1', 'cat_matcha', 'Matcha Latte', 'Our everyday matcha, whisked with fresh milk.', 6.00, true, false, 'matcha', null, 0),
  ('m2', 'cat_matcha', 'Strawberry Matcha', 'Layered strawberry puree with ceremonial matcha.', 7.00, true, false, 'strawberry', null, 1),
  ('m3', 'cat_matcha', 'Sea Salt Foam Matcha', 'Matcha topped with a whisked sea salt cream foam.', 7.00, true, false, null, 'assets/sea-salt-matcha.jpg', 2),
  ('m4', 'cat_matcha', 'Biscoff Matcha', 'Matcha and biscoff caramel, swirled together.', 7.50, true, false, null, 'assets/biscoff-matcha.jpg', 3)
on conflict (id) do nothing;

insert into item_milks (item_id, id, name, price, sort_order) values
  ('m1', 'milk1', 'Fresh milk', 0, 0), ('m1', 'milk2', 'Oat milk', 0.80, 1), ('m1', 'milk3', 'Soy milk', 0.60, 2),
  ('m2', 'milk1', 'Fresh milk', 0, 0), ('m2', 'milk2', 'Oat milk', 0.80, 1),
  ('m3', 'milk1', 'Fresh milk', 0, 0), ('m3', 'milk3', 'Soy milk', 0.60, 1),
  ('m4', 'milk1', 'Fresh milk', 0, 0), ('m4', 'milk2', 'Oat milk', 0.80, 1)
on conflict (item_id, id) do nothing;

insert into item_toppings (item_id, id, name, price, sort_order) values
  ('m1', 'top1', 'Extra matcha shot', 1.50, 0), ('m1', 'top2', 'Pearls', 0.80, 1),
  ('m2', 'top1', 'Extra matcha shot', 1.50, 0), ('m2', 'top2', 'Pearls', 0.80, 1), ('m2', 'top3', 'Grass jelly', 0.80, 2),
  ('m3', 'top1', 'Extra matcha shot', 1.50, 0)
on conflict (item_id, id) do nothing;

-- get_menu(): reassembles {categories: {name: [items...]}} in one
-- round trip, matching what src/components/ already expects.
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

-- save_menu_item(): one round trip for the admin item editor — resolves
-- or creates the category by name, upserts the item, and replaces its
-- milk/topping/sugar-level rows, all in one transaction.
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
    select p_id, sg.value #>> '{}', ord - 1
    from jsonb_array_elements(p_sugar_levels) with ordinality as t(sg, ord);
end;
$$;

-- Storage bucket for drink thumbnail photos, uploaded from the staff Menu
-- editor. Public so the customer app can display them directly.
insert into storage.buckets (id, name, public)
values ('menu-photos', 'menu-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read menu photos" on storage.objects;
create policy "public read menu photos" on storage.objects
  for select using (bucket_id = 'menu-photos');

drop policy if exists "public upload menu photos" on storage.objects;
create policy "public upload menu photos" on storage.objects
  for insert with check (bucket_id = 'menu-photos');

drop policy if exists "public replace menu photos" on storage.objects;
create policy "public replace menu photos" on storage.objects
  for update using (bucket_id = 'menu-photos');
-- Same trade-off as elsewhere in this file: anyone with your public anon
-- key could technically upload to this bucket too. Fine for a small stall;
-- real Supabase Auth would be the fix if that ever matters more.

create table if not exists orders (
  id text primary key,
  name text,
  phone text,
  date timestamptz default now(),
  items jsonb,
  total numeric,
  notes text,
  status text default 'Received',
  stripe_session_id text
);
alter table orders add column if not exists stripe_session_id text;

-- Loyalty stamps live here as a real, directly-editable number per phone —
-- not calculated from order count — so staff can adjust them by hand
-- (bonus stamps, corrections, walk-up cash sales entered manually, etc).
create table if not exists customers (
  phone text primary key,
  name text,
  stamps integer not null default 0,
  updated_at timestamptz default now()
);


-- ---------------------------------------------------------------
-- Staff passphrase: stored hashed, in its own table with NO public
-- read/write access at all. The app never receives the real
-- passphrase back — only true/false from the functions below.
-- ---------------------------------------------------------------
create table if not exists staff_auth (
  id text primary key default 'main',
  pin_hash text not null
);
insert into staff_auth (id, pin_hash)
  values ('main', extensions.crypt('QUEENraks!', extensions.gen_salt('bf')))
  on conflict (id) do nothing;

create or replace function check_staff_pin(candidate text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from staff_auth where id = 'main' and pin_hash = extensions.crypt(candidate, pin_hash)
  );
$$;

create or replace function set_staff_pin(old_pin text, new_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if exists (select 1 from staff_auth where id = 'main' and pin_hash = extensions.crypt(old_pin, pin_hash)) then
    update staff_auth set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf')) where id = 'main';
    return true;
  else
    return false;
  end if;
end;
$$;

-- Row Level Security
alter table settings enable row level security;
alter table categories enable row level security;
alter table items enable row level security;
alter table item_milks enable row level security;
alter table item_toppings enable row level security;
alter table item_sugar_levels enable row level security;
alter table orders enable row level security;
alter table customers enable row level security;
alter table staff_auth enable row level security;
-- staff_auth intentionally gets NO policies below — that means nobody
-- (not even with the public anon key) can read or write it directly.
-- The two functions above can still reach it because they run as
-- "security definer", and only they are granted to the public below.

grant execute on function check_staff_pin(text) to anon;
grant execute on function set_staff_pin(text, text) to anon;
grant execute on function get_menu() to anon;
grant execute on function save_menu_item(text, text, text, text, numeric, boolean, text, text, jsonb, jsonb, jsonb) to anon;

-- IMPORTANT: these policies are permissive (anyone with your public anon
-- key can read and write orders/menu/settings). That's a normal trade-off
-- for a small static-site project like this one — the part that actually
-- protects your staff dashboard (the passphrase) is locked down properly
-- above. If you ever want orders/menu locked down too, that needs real
-- Supabase Auth — ask me about it later if it matters to you.

drop policy if exists "public read settings" on settings;
create policy "public read settings" on settings for select using (true);
drop policy if exists "public update settings" on settings;
create policy "public update settings" on settings for update using (true);

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

drop policy if exists "public read orders" on orders;
create policy "public read orders" on orders for select using (true);
drop policy if exists "public insert orders" on orders;
create policy "public insert orders" on orders for insert with check (true);
drop policy if exists "public update orders" on orders;
create policy "public update orders" on orders for update using (true);
drop policy if exists "public delete orders" on orders;
create policy "public delete orders" on orders for delete using (true);

drop policy if exists "public read customers" on customers;
create policy "public read customers" on customers for select using (true);
drop policy if exists "public insert customers" on customers;
create policy "public insert customers" on customers for insert with check (true);
drop policy if exists "public update customers" on customers;
create policy "public update customers" on customers for update using (true);
drop policy if exists "public delete customers" on customers;
create policy "public delete customers" on customers for delete using (true);
