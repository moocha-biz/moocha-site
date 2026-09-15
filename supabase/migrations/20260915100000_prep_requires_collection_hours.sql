-- Gates "start preparing" (both the web button's deep link and the
-- Telegram bot's bare "prepare" command — both call this same RPC) on the
-- shop's collection hours (settings.collection_start/collection_end, the
-- only "opening hours" concept this app has — see SettingsTab.jsx's
-- "Collection hours" section). Without this, a customer could ask staff to
-- start on a drink placed 1-2 days ahead of pickup at 3am, well before
-- anyone's even at the shop — the exact "too early and it sits/melts
-- before pickup" problem this feature was built to avoid in the first
-- place (see request_order_prep's original comment in store.jsx).
--
-- Raises a specific exception per case (matching this app's existing
-- convention — see place_redeemed_order's 'not_eligible', etc.) so callers
-- can give a tailored message instead of a generic failure. Either bound
-- being null means "no restriction", same as ordersOpen's treatment of a
-- null preorder_close_at elsewhere.
create or replace function request_order_prep(p_id text, p_phone text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_ahead integer;
  v_collection_start timestamptz;
  v_collection_end timestamptz;
begin
  select collection_start, collection_end into v_collection_start, v_collection_end from settings where id = 'main';
  if v_collection_start is not null and now() < v_collection_start then
    raise exception 'not_open_yet';
  end if;
  if v_collection_end is not null and now() > v_collection_end then
    raise exception 'collection_closed';
  end if;

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
