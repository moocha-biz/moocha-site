-- notify-telegram is callable without staff auth (see its header), so
-- anything that knew an order id could call it in a loop and spam that
-- order's linked customer with the same status DM. Each stage now records
-- when its DM went out, and notify-telegram claims that slot atomically
-- before sending — at most one DM per order per stage, however many times
-- it's called.
alter table orders add column if not exists preparing_notified_at timestamptz;
alter table orders add column if not exists ready_notified_at timestamptz;
