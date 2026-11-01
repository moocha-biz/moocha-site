-- Counterpart to preorder_close_at (20260903130000_preorder_auto_close.sql):
-- lets admin schedule when preorders open, so a week's window can be set
-- ahead of time in one go. Same no-cron approach — "is ordering open" is
-- payment_enabled AND (no open time OR now >= it) AND (no cutoff OR now <
-- it), computed fresh on every read in store.jsx's `ordersOpen` and
-- server-side in _shared/ordersOpen.ts.
alter table settings add column if not exists preorder_open_at timestamptz;
