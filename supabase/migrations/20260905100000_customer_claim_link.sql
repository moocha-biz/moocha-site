-- Lets an existing walk-in customer link their stamps to the website for
-- the first time, without needing to have placed a paid online order yet.
--
-- The problem: get_my_stamps/get_my_orders require a customers.access_token
-- that's proven the caller's browser is really that phone's owner (see
-- fix_phone_and_receipt_idor.sql) — otherwise a phone number alone (an
-- 8-digit SG mobile number, brute-forceable) would let anyone read anyone
-- else's stamp count. That token only gets minted once, inside the receipt
-- right after a Stripe-paid order. A customer whose stamps came entirely
-- from in-person walk-in visits never triggers that mint, so they have no
-- self-service way to check or redeem their stamps online.
--
-- Fix: staff (already looking at the customer's record in person, the same
-- trust boundary walk-in redemption already relies on) generate a random,
-- single-use, short-lived claim_code from the admin dashboard. The
-- customer opens a link containing that code on their own device, which
-- mints (or reveals) their access_token and saves it to their browser —
-- after which they're a normal self-service customer, same as if they'd
-- ordered online. The code itself is deliberately NOT the access_token: a
-- 15-minute, one-time-use code is safe to display/share once, where the
-- permanent access_token never should be.

alter table customers add column if not exists claim_code text;
alter table customers add column if not exists claim_code_expires_at timestamptz;

-- Staff-only (invoker-rights, bound by the existing "staff all customers"
-- RLS policy, same as every other staff action on this table).
create or replace function generate_customer_claim(p_phone text)
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  v_code := replace(gen_random_uuid()::text, '-', '');
  update customers set claim_code = v_code, claim_code_expires_at = now() + interval '15 minutes'
  where phone = p_phone;
  if not found then
    raise exception 'Customer not found';
  end if;
  return v_code;
end;
$$;

-- Anon-callable and SECURITY DEFINER — this is the one place an
-- unauthenticated customer browser is allowed to touch the customers
-- table, and only because the code itself (not a guessable phone number)
-- is the proof of ownership. Single-use: the code is cleared the moment
-- it's redeemed, so a link that leaks after being used (screenshot, shared
-- chat, etc.) can't be replayed.
create or replace function redeem_customer_claim(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row customers%rowtype;
begin
  select * into v_row from customers
  where claim_code = p_code and claim_code_expires_at > now();
  if not found then
    raise exception 'This link has expired or was already used — ask staff for a new one';
  end if;

  if v_row.access_token is null then
    v_row.access_token := gen_random_uuid()::text;
  end if;

  update customers set
    access_token = v_row.access_token, claim_code = null, claim_code_expires_at = null
  where phone = v_row.phone;

  return jsonb_build_object(
    'phone', v_row.phone, 'name', v_row.name, 'customerToken', v_row.access_token, 'stamps', v_row.stamps
  );
end;
$$;

grant execute on function generate_customer_claim(text) to authenticated;
grant execute on function redeem_customer_claim(text) to anon, authenticated;
