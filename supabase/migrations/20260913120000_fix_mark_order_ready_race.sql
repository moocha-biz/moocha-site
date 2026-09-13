-- mark_order_ready's WHERE status = 'Received' guard silently matches zero
-- rows if the order's already Ready (no Postgres error on a 0-row UPDATE),
-- but the caller (markOrderReady in store.jsx) never checked that — so a
-- double-click, or two staff sessions racing on the same order, both fell
-- through to invoking notify-telegram, which found status already 'Ready'
-- and sent a second, duplicate "your order is ready" DM.
--
-- Returns whether it actually changed a row, so the client can skip the
-- notification entirely when it didn't. Postgres refuses to change a
-- function's return type via CREATE OR REPLACE (void -> boolean here), so
-- the old signature has to be dropped first.
drop function if exists mark_order_ready(text);
create or replace function mark_order_ready(p_id text)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update orders set status = 'Ready', ready_at = now(), ready_by = auth.email()
  where id = p_id and status = 'Received';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function mark_order_ready(text) to authenticated;
