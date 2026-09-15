-- aheadDrinks (added in queue_depth_estimate.sql) is a one-time snapshot
-- computed only inside request_order_prep — it never updates again, and a
-- page reload loses it entirely since nothing re-fetches it. Its
-- computation also has no time ordering: it sums every order currently
-- 'Preparing' regardless of whether that order started preparing before or
-- after the one asking, so it can overcount.
--
-- This adds a callable-anytime version, correctly ordered by
-- prep_requested_at, that the client can poll while an order sits in
-- 'Preparing' (My Rewards, the post-payment screen), and that
-- notify-telegram/telegram-webhook can call to tell a customer their
-- current position over the bot.
create or replace function get_queue_position(p_order_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when o.status <> 'Preparing' then jsonb_build_object('preparing', false)
  else jsonb_build_object('preparing', true, 'aheadDrinks', (
    select coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0)
    from orders o2, jsonb_array_elements(coalesce(o2.items, '[]'::jsonb)) li
    where o2.status = 'Preparing' and o2.id <> o.id and o2.prep_requested_at < o.prep_requested_at
  )) end
  from orders o where o.id = p_order_id;
$$;

grant execute on function get_queue_position(text) to anon, authenticated;
