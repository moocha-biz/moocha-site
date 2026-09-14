-- request_order_prep (20260914140000) only lets the customer themselves
-- flip Received -> Preparing. Staff need the same lever for a customer who
-- calls in or asks in person instead of using the app.
--
-- prep_requested_by mirrors ready_by/collected_by's audit style: null when
-- the customer triggered it via request_order_prep (self-service, no staff
-- account involved), set to auth.email() when staff trigger it here.

alter table orders add column if not exists prep_requested_by text;

create or replace function mark_order_preparing(p_id text)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update orders set status = 'Preparing', prep_requested_at = now(), prep_requested_by = auth.email()
  where id = p_id and status = 'Received';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function mark_order_preparing(text) to authenticated;
