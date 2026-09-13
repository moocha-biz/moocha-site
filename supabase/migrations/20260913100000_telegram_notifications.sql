-- Lets a customer optionally link a Telegram account so a bot can DM them
-- the moment their order is ready for pickup, instead of them having to
-- check back or be called out at the counter.
--
-- New order status: 'Ready', sitting between 'Received' and 'Collected'.
-- 'Collected' keeps its current meaning ("customer already picked it up")
-- — the DM fires on a new "Mark ready" staff action, not on "Mark
-- collected". orders.status is a plain text column with no CHECK
-- constraint, so no constraint migration is needed for the new value.
--
-- Telegram's Bot API can't DM a user by @username alone (anti-spam by
-- design) — it requires the user to message the bot first. So linking is a
-- deep-link + webhook handshake, shaped like customer_claim_link.sql's
-- claim_code (a short-lived, single-use code the customer's own browser
-- redeems), not a plain text field.

alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists ready_by text;

alter table customers add column if not exists telegram_chat_id bigint;
alter table customers add column if not exists telegram_username text;
alter table customers add column if not exists telegram_link_code text;
alter table customers add column if not exists telegram_link_code_expires_at timestamptz;

-- Mints a 15-minute, single-use link code for a phone number, same shape
-- as generate_customer_claim — except this one has to be anon-callable
-- (checkout/My Rewards call it from an unauthenticated browser, not
-- staff), so it needs its own ownership check instead of relying on RLS.
--
-- Ownership rule, tighter than "mirror get_my_stamps": if a customers row
-- already exists for this phone AND has an access_token, p_token must
-- match it (blocks hijacking someone else's linked account). If no row
-- exists yet, allow it — a genuinely first-time customer at checkout has
-- neither a row nor a token. But if a row exists WITHOUT an access_token
-- (a walk-in-only customer who's never proven ownership online), this
-- does NOT silently allow linking — unlike get_my_stamps (read-only,
-- falls back to "no data") a link here is a write with a real consequence:
-- it would let anyone who merely knows/guesses that phone number redirect
-- that customer's future "order ready" pings to a stranger's Telegram
-- account (misdirected notifications, and a presence-tracking leak — a
-- stranger learning exactly when that person's order is ready). Such a
-- customer needs to claim their account first (see redeem_customer_claim)
-- before they can link Telegram from My Rewards.
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
    else
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

-- Read-only status check for the polling UI. Deliberately more lenient
-- than generate_telegram_link_code above: it only ever reveals whether
-- Telegram is connected and the linked @username (not stamps, not order
-- history), and the common caller right after generate_telegram_link_code
-- succeeded is a brand-new phone with no access_token yet — requiring a
-- token match here would break that polling flow entirely.
create or replace function get_my_telegram_link_status(p_phone text, p_token text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('linked', telegram_chat_id is not null, 'username', telegram_username)
      from customers
      where phone = p_phone
        and (access_token is null or access_token = p_token)),
    jsonb_build_object('linked', false, 'username', null)
  );
$$;

-- NOT anon-grantable and NOT security definer, unlike redeem_customer_claim
-- (safe as anon+SECURITY DEFINER because the code itself, typed back by the
-- same browser, *is* the proof of ownership). The real proof of ownership
-- here is that a genuine Telegram user sent /start <code> to the bot — a
-- fact only Telegram's webhook delivery attests to. If this were
-- anon-callable, any browser could call it directly with an observed code
-- and an arbitrary p_chat_id, linking someone else's phone without ever
-- completing the Telegram handshake.
--
-- No grant is issued to anon or authenticated, so only service_role (which
-- bypasses grants and RLS entirely) can actually execute it — in practice
-- only the telegram-webhook edge function, using its service-role client.
create or replace function redeem_telegram_link_code(p_code text, p_chat_id bigint, p_username text default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
begin
  select phone into v_phone from customers
  where telegram_link_code = p_code and telegram_link_code_expires_at > now();
  if not found then
    return null;
  end if;

  update customers set
    telegram_chat_id = p_chat_id, telegram_username = p_username,
    telegram_link_code = null, telegram_link_code_expires_at = null
  where phone = v_phone;

  return v_phone;
end;
$$;

-- Mirrors mark_order_collected's audit style (auth.email() into a new
-- ready_by column, same as collected_by in staff_audit_trail.sql).
create or replace function mark_order_ready(p_id text)
returns void
language plpgsql
as $$
begin
  update orders set status = 'Ready', ready_at = now(), ready_by = auth.email()
  where id = p_id and status = 'Received';
end;
$$;

grant execute on function generate_telegram_link_code(text, text) to anon, authenticated;
grant execute on function get_my_telegram_link_status(text, text) to anon, authenticated;
grant execute on function mark_order_ready(text) to authenticated;

-- ---- Existing functions re-created to account for the new 'Ready' status ----

-- Without this, marking an order ready would make "Mark collected"
-- silently no-op afterward (v_status is distinct from 'Received' would now
-- be true for a Ready order too) — a dead end: no error, but the order
-- never transitions and no stamp is ever awarded.
create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
  v_order_type text;
  v_items jsonb;
  v_total numeric;
  v_free_qty integer;
  v_already_deducted boolean;
  v_earned integer;
begin
  select phone, name, status, order_type, items, total
    into v_phone, v_name, v_status, v_order_type, v_items, v_total
  from orders where id = p_id;
  if v_status not in ('Received', 'Ready') then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now(), collected_by = auth.email() where id = p_id;

  select
    coalesce(sum(
      case when coalesce((li->>'redeemed')::boolean, false)
        then coalesce((li->>'freeQty')::integer, 1)
        else 0
      end
    ), 0),
    coalesce(sum(coalesce((li->>'qty')::integer, 0)), 0)
      - coalesce(sum(
          case when coalesce((li->>'redeemed')::boolean, false)
            then coalesce((li->>'freeQty')::integer, 1)
            else 0
          end
        ), 0)
    into v_free_qty, v_earned
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) li;

  -- Only place_redeemed_order's $0 online redemption deducts stamps at
  -- placement — that's order_type = 'preorder' with total = 0 specifically
  -- (a walk-in redeeming for free also has total = 0, but never deducts
  -- until collection, so it still owes the deduction here).
  v_already_deducted := (v_order_type = 'preorder' and v_total = 0);

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set
        stamps = stamps + v_earned - (case when not v_already_deducted then 8 * v_free_qty else 0 end),
        name = coalesce(nullif(v_name, ''), name), updated_at = now()
      where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), greatest(v_earned, 0));
    end if;
  end if;
end;
$$;

-- Adds 'Ready' to the refundable statuses, and to the branch that reverses
-- place_redeemed_order's upfront stamp deduction for a $0 redeemed
-- preorder — a ready-but-uncollected $0 redemption still needs its stamps
-- restored correctly on refund. The v_status = 'Collected' earn-reversal
-- branch is untouched.
create or replace function refund_order(p_id text, p_refund_id text default null)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_order_type text;
  v_phone text;
  v_items jsonb;
  v_total numeric;
  v_free_qty integer;
  v_earned integer;
  li jsonb;
  v_item_id text;
  v_qty integer;
begin
  select status, order_type, phone, items, total into v_status, v_order_type, v_phone, v_items, v_total
  from orders where id = p_id;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status not in ('Received', 'Ready', 'Collected') then
    raise exception 'Only a received, ready, or collected order can be refunded (this one is %)', v_status;
  end if;

  update orders set status = 'Refunded', refunded_at = now(), refunded_by = auth.email(), refund_id = p_refund_id
  where id = p_id;

  for li in select * from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      if v_order_type = 'walkin' then
        update items set walkin_sold = greatest(walkin_sold - v_qty, 0) where id = v_item_id;
      else
        update items set preorder_sold = greatest(preorder_sold - v_qty, 0) where id = v_item_id;
      end if;
    end if;
  end loop;

  if v_phone is not null and v_phone <> '' then
    select
      coalesce(sum(
        case when coalesce((it->>'redeemed')::boolean, false)
          then coalesce((it->>'freeQty')::integer, 1)
          else 0
        end
      ), 0),
      coalesce(sum(coalesce((it->>'qty')::integer, 0)), 0)
        - coalesce(sum(
            case when coalesce((it->>'redeemed')::boolean, false)
              then coalesce((it->>'freeQty')::integer, 1)
              else 0
            end
          ), 0)
      into v_free_qty, v_earned
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    if v_status = 'Collected' then
      update customers set
        stamps = greatest(stamps - v_earned + 8 * v_free_qty, 0),
        updated_at = now()
      where phone = v_phone;
    elsif v_status in ('Received', 'Ready') and v_free_qty > 0 and v_total = 0 and v_order_type = 'preorder' then
      -- place_redeemed_order deducted its stamps immediately at placement
      -- rather than waiting for collection — undo that. A walk-in order
      -- never reaches here (it doesn't deduct until collection), so it
      -- correctly falls through with no stamp change.
      update customers set stamps = stamps + 8 * v_free_qty, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;
