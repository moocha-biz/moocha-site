-- Lets staff generate a Telegram-connect link/QR for a walk-in customer at
-- the counter — the same self-service generate_telegram_link_code() that
-- checkout/My Rewards use is deliberately NOT usable here: it raises
-- 'needs_claim' for any customers row that already exists without an
-- access_token (a walk-in-only customer who's never proven ownership
-- online), specifically to stop a stranger who merely knows/guesses a
-- phone number from redirecting that customer's order-ready pings to
-- their own Telegram account.
--
-- In person, staff ARE that proof of ownership (same trust boundary the
-- existing generate_customer_claim/redeem_customer_claim stamps-claim flow
-- already relies on) — so this mints the same telegram_link_code/
-- telegram_link_code_expires_at pair, redeemed through the exact same
-- redeem_telegram_link_code() the customer-facing flow uses, just without
-- the ownership check that only makes sense for a browser calling this on
-- its own.
create or replace function generate_telegram_link_code_staff(p_phone text)
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  v_code := replace(gen_random_uuid()::text, '-', '');
  insert into customers (phone, telegram_link_code, telegram_link_code_expires_at)
    values (p_phone, v_code, now() + interval '15 minutes')
  on conflict (phone) do update set
    telegram_link_code = excluded.telegram_link_code,
    telegram_link_code_expires_at = excluded.telegram_link_code_expires_at;
  return v_code;
end;
$$;

grant execute on function generate_telegram_link_code_staff(text) to authenticated;

-- No changes needed for walk-in "Ready" notifications: mark_order_ready
-- already has no order_type restriction, and notify-telegram already looks
-- up any order's phone -> customers.telegram_chat_id regardless of
-- order_type — both already work for walk-ins the moment a walk-in order
-- reaches 'Ready'. The only gap was the admin UI never offering "Mark
-- ready" for a walk-in order (see OrderDetailSheet.jsx), which is a
-- frontend-only change.
