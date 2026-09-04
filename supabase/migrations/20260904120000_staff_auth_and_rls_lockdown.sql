-- Real authentication for the admin dashboard, replacing the shared-
-- passphrase RPC (check_staff_pin/set_staff_pin) — but the part that
-- actually secures anything is the RLS rewrite below: every admin-
-- touching table moves from "anyone holding the public anon key" (every
-- policy so far has been `using (true)`) to "authenticated staff only".
--
-- Customers never sign in — there's no real identity to scope rows to —
-- so three narrow SECURITY DEFINER functions replace the raw table reads
-- they used for self-service (own stamp count, own order history, one
-- order's receipt right after checkout). That's what lets `customers`
-- and `orders` stop being anon-readable at all without breaking those
-- features. These functions trust whatever phone/order-id the caller
-- supplies, same as the app always has (there's no SMS/OTP verification
-- of phone ownership) — but that's strictly narrower than before, where
-- the *entire* customers/orders tables were openly readable by anyone.
--
-- After this runs, create the one shared staff account via the Supabase
-- Dashboard: Authentication -> Users -> Add user.

-- ---- categories / items / item_sugar_levels: public read stays, write becomes staff-only ----
drop policy if exists "public write categories" on categories;
drop policy if exists "staff write categories" on categories;
create policy "staff write categories" on categories for all to authenticated using (true) with check (true);

drop policy if exists "public write items" on items;
drop policy if exists "staff write items" on items;
create policy "staff write items" on items for all to authenticated using (true) with check (true);

drop policy if exists "public write item_sugar_levels" on item_sugar_levels;
drop policy if exists "staff write item_sugar_levels" on item_sugar_levels;
create policy "staff write item_sugar_levels" on item_sugar_levels for all to authenticated using (true) with check (true);

-- ---- settings: public read stays (customers need hours/open-closed), write becomes staff-only ----
drop policy if exists "public update settings" on settings;
drop policy if exists "staff update settings" on settings;
create policy "staff update settings" on settings for update to authenticated using (true) with check (true);

-- ---- customers: no more anon access at all — self-service now goes through get_my_stamps() ----
drop policy if exists "public read customers" on customers;
drop policy if exists "public insert customers" on customers;
drop policy if exists "public update customers" on customers;
drop policy if exists "public delete customers" on customers;
drop policy if exists "staff all customers" on customers;
create policy "staff all customers" on customers for all to authenticated using (true) with check (true);

-- ---- orders: same — self-service goes through get_my_orders()/get_order_receipt() ----
drop policy if exists "public read orders" on orders;
drop policy if exists "public insert orders" on orders;
drop policy if exists "public update orders" on orders;
drop policy if exists "public delete orders" on orders;
drop policy if exists "staff all orders" on orders;
create policy "staff all orders" on orders for all to authenticated using (true) with check (true);

-- ---- menu-photos storage: public read (customers see photos), write becomes staff-only ----
drop policy if exists "public upload menu photos" on storage.objects;
drop policy if exists "staff upload menu photos" on storage.objects;
create policy "staff upload menu photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos');

drop policy if exists "public replace menu photos" on storage.objects;
drop policy if exists "staff replace menu photos" on storage.objects;
create policy "staff replace menu photos" on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos');

-- ---- retire the shared-passphrase mechanism entirely — superseded by real Supabase Auth ----
drop function if exists check_staff_pin(text);
drop function if exists set_staff_pin(text, text);
drop table if exists staff_auth;

-- ---- narrow, anon-callable self-service reads ----
create or replace function get_my_stamps(p_phone text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select stamps from customers where phone = p_phone), 0);
$$;

create or replace function get_my_orders(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'date', date, 'items', items, 'total', total, 'status', status
  ) order by date desc), '[]'::jsonb)
  from orders where phone = p_phone;
$$;

create or replace function get_order_receipt(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'items', items, 'total', total, 'status', status)
  from orders where id = p_id;
$$;

grant execute on function get_my_stamps(text) to anon;
grant execute on function get_my_orders(text) to anon;
grant execute on function get_order_receipt(text) to anon;
