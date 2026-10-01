-- Enables Supabase Realtime (Postgres Changes) on the orders table so the
-- admin Orders tab can auto-refresh the moment any order changes — a new
-- order placed, a customer requesting prep via Telegram, a status update,
-- etc. — instead of only ever updating on a manual "Refresh" click (see
-- src/store.jsx's new admin-orders-changes subscription).
--
-- RLS already governs which rows a subscribed client receives events for,
-- same as any other read — the existing "staff all orders" policy (any
-- authenticated session) covers the admin dashboard's own subscription.
--
-- Guarded so it's safe to re-run: this was applied by hand on the live
-- project before being recorded in schema_migrations, and a plain
-- `alter publication ... add table` errors if the table's already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;
