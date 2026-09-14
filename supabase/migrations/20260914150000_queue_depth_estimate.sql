-- Nana (see chat, 2026-09-14): when a customer taps "prepare my drink", tell
-- them how many drinks are already queued ahead of them, so the count
-- itself acts as a rough wait estimate without staff having to guess a
-- number of minutes.
--
-- A snapshot at request time, not a live countdown: computed once, right
-- when request_order_prep runs, from how many drink units are already
-- sitting in 'Preparing' (i.e. staff have already been asked to start on
-- them) at that instant. Walk-ins never pass through 'Preparing' (they're
-- handed over on the spot), so they don't factor in here — this is
-- specifically the preorder "asked to start" queue, which is also the only
-- queue a remote customer's wait actually depends on.
--
-- Postgres refuses to change a function's return type via CREATE OR
-- REPLACE (boolean -> jsonb here), so the old signature has to be dropped
-- first.
drop function if exists request_order_prep(text, text, text);
create or replace function request_order_prep(p_id text, p_phone text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_ahead integer;
begin
  update orders set status = 'Preparing', prep_requested_at = now()
  where id = p_id and phone = p_phone and status = 'Received'
    and exists (
      select 1 from customers c
      where c.phone = p_phone and c.access_token is not null and c.access_token = p_token
    );
  get diagnostics v_rows = row_count;

  select coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0) into v_ahead
  from orders o, jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) li
  where o.status = 'Preparing' and o.id <> p_id;

  return jsonb_build_object('changed', v_rows > 0, 'aheadDrinks', v_ahead);
end;
$$;

grant execute on function request_order_prep(text, text, text) to anon, authenticated;
