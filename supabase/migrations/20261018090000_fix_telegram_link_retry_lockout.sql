-- A first-time customer who doesn't finish linking Telegram on their first
-- try could never link at all. generate_telegram_link_code's "no row yet"
-- branch inserts a customers row holding just the link code — no
-- access_token — and every later call then hit the "row exists without an
-- access_token" branch and raised 'needs_claim'. So tapping "Connect again"
-- after the browser's poll gave up, connecting from checkout and then from
-- Orders, or simply coming back after the 15-minute code expired all
-- locked the customer out until they paid for an order online or got a
-- staff QR.
--
-- Fix: a row that only exists because of an earlier, unfinished link
-- attempt is treated the same as no row at all. Such a row is recognisable
-- by everything those attempts never set: no access_token, no name (every
-- order/collection path writes at least ''), no stamps, no Telegram chat
-- linked yet, and no live or collected orders under that phone (an
-- abandoned Stripe checkout leaves a 'Payment failed' row behind, and that
-- customer is exactly who hits this, so failed/refunded orders don't
-- count). That's exactly as permissive
-- as the existing "no row" case, so a genuine walk-in customer — whose row
-- has a name, stamps or orders — still gets 'needs_claim' and can't have
-- their order-ready pings redirected by someone who merely knows their
-- phone number. A tokenless row that was already linked (staff QR) also
-- stays protected.
create or replace function generate_telegram_link_code(p_phone text, p_token text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing customers%rowtype;
  v_code text;
begin
  select * into v_existing from customers where phone = p_phone;
  if found then
    if v_existing.access_token is not null then
      if p_token is null or p_token <> v_existing.access_token then
        raise exception 'not_authorized';
      end if;
    elsif v_existing.name is not null
      or v_existing.stamps <> 0
      or v_existing.telegram_chat_id is not null
      or exists (
        select 1 from orders
        where phone = p_phone and status in ('Received', 'Preparing', 'Ready', 'Collected')
      ) then
      raise exception 'needs_claim';
    end if;
  end if;

  v_code := replace(gen_random_uuid()::text, '-', '');
  insert into customers (phone, telegram_link_code, telegram_link_code_expires_at)
    values (p_phone, v_code, now() + interval '15 minutes')
  on conflict (phone) do update set
    telegram_link_code = excluded.telegram_link_code,
    telegram_link_code_expires_at = excluded.telegram_link_code_expires_at;

  return v_code;
end;
$$;
