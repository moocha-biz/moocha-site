-- Lets admin schedule an exact cutoff time for preorders, instead of
-- having to remember to flip the "Accepting orders" toggle off by hand.
-- No cron job needed: "is ordering open" is just payment_enabled AND
-- (no cutoff set OR now is before it) — computed fresh on every read,
-- both client-side (store.jsx's `ordersOpen`) and server-side in
-- create-checkout-session, so a stale browser clock can't be used to
-- sneak an order in past the cutoff.
alter table settings add column if not exists preorder_close_at timestamptz;
