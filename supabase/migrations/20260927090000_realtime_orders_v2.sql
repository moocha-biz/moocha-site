-- Re-applies 20260915120000_realtime_orders.sql idempotently (it's unclear
-- whether that one was ever actually run against the live project, which
-- would fully explain admin not auto-updating on new /prepare requests —
-- a plain `alter publication ... add table` errors if the table's already
-- a member, so this checks first instead of assuming either way).
--
-- Also sets replica identity full on orders: by default Postgres only
-- guarantees the primary key in a Realtime UPDATE payload's "old" row —
-- the admin-orders-changes subscription (src/store.jsx) needs old.status
-- to tell "just entered Preparing" apart from "already was Preparing,
-- something unrelated changed" before it plays the prep-request chime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

alter table orders replica identity full;
