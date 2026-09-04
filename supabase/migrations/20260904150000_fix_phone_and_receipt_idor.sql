-- Closes two IDOR holes left by the previous lockdown migration: the three
-- anon-callable self-service RPCs (get_order_receipt / get_my_stamps /
-- get_my_orders) are SECURITY DEFINER and were keyed purely on values an
-- attacker can guess or brute-force — there was no check that the caller
-- actually owns the phone/order they're asking about.
--
--   * get_order_receipt(p_id) took the customer-facing order id, which is
--     just 'M' + the last 6 digits of Date.now() (see CheckoutSheet.jsx) —
--     ~1e6 possibilities, enumerable in minutes.
--   * get_my_stamps/get_my_orders(p_phone) took an SG mobile number — an
--     8-digit space, also brute-forceable — with no proof the caller's
--     browser is actually that customer's.
--
-- Fix: get_order_receipt is now keyed on orders.stripe_session_id instead
-- of the human-readable order id. That id is a long, high-entropy string
-- Stripe generates itself, and the client only learns it via Stripe's own
-- {CHECKOUT_SESSION_ID} redirect substitution (see create-checkout-session
-- and CheckoutSheet.jsx) — not guessable.
--
-- get_my_stamps/get_my_orders now additionally require a random
-- access_token, stored on the customers row and hand back to the browser
-- exactly once — inside the receipt right after a paid order (see
-- stripe-webhook, which mints it, and get_order_receipt, which returns it).
-- A phone number alone is no longer enough to read someone else's stamp
-- count or order history.

alter table customers add column if not exists access_token text;

-- Postgres refuses to rename a parameter via CREATE OR REPLACE even when
-- the type is unchanged (SQLSTATE 42P13), so the old p_id signature has to
-- be dropped first.
drop function if exists get_order_receipt(text);
create or replace function get_order_receipt(p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id, 'items', o.items, 'total', o.total, 'status', o.status,
    'customerToken', c.access_token
  )
  from orders o
  left join customers c on c.phone = o.phone and o.phone is not null and o.phone <> ''
  where o.stripe_session_id = p_session_id;
$$;

drop function if exists get_my_stamps(text);
create or replace function get_my_stamps(p_phone text, p_token text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select stamps from customers
      where phone = p_phone and access_token is not null and access_token = p_token),
    0
  );
$$;

drop function if exists get_my_orders(text);
create or replace function get_my_orders(p_phone text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'date', date, 'items', items, 'total', total, 'status', status
  ) order by date desc), '[]'::jsonb)
  from orders
  where phone = p_phone
    and exists (
      select 1 from customers c
      where c.phone = p_phone and c.access_token is not null and c.access_token = p_token
    );
$$;

grant execute on function get_order_receipt(text) to anon;
grant execute on function get_my_stamps(text, text) to anon;
grant execute on function get_my_orders(text, text) to anon;
