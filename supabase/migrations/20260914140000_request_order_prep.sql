-- Lets a customer who preordered ahead of arrival tell staff "start making
-- it now" instead of staff guessing when to start (too early and the drink
-- sits/melts before pickup; too late and the customer waits at the
-- counter). New order status: 'Preparing', sitting between 'Received' and
-- 'Ready'. Purely optional — staff can still jump straight from 'Received'
-- to 'Ready' on their own judgment, same as today, so nothing is stuck
-- waiting on a customer who never taps the button.
--
-- orders.status is a plain text column with no CHECK constraint (see
-- 20260913100000_telegram_notifications.sql), so no constraint migration
-- is needed for the new value.

alter table orders add column if not exists prep_requested_at timestamptz;

-- Same ownership model as get_my_orders/get_my_stamps: phone plus the
-- access_token minted once into the receipt after a paid order. Anon-
-- callable (My Rewards and the post-checkout screen both call this from an
-- unauthenticated browser), so — like those two — it has to do its own
-- ownership check instead of relying on RLS.
--
-- Returns whether it actually changed a row (mirrors mark_order_ready's
-- race fix) so the client can tell "just started preparing" apart from
-- "already past that point" without a second read.
create or replace function request_order_prep(p_id text, p_phone text, p_token text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update orders set status = 'Preparing', prep_requested_at = now()
  where id = p_id and phone = p_phone and status = 'Received'
    and exists (
      select 1 from customers c
      where c.phone = p_phone and c.access_token is not null and c.access_token = p_token
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function request_order_prep(text, text, text) to anon, authenticated;

-- ---- Existing functions re-created to account for the new 'Preparing' status ----

-- Staff can now mark ready either straight from 'Received' (unchanged) or
-- from 'Preparing' (the customer asked for it) — the customer's signal is
-- a hint, not a gate.
create or replace function mark_order_ready(p_id text)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update orders set status = 'Ready', ready_at = now(), ready_by = auth.email()
  where id = p_id and status in ('Received', 'Preparing');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function mark_order_ready(text) to authenticated;

-- Adds 'Preparing' alongside 'Received' in the set of statuses a collect
-- can advance from, so a preorder that had prep requested but was then
-- collected without ever passing through an explicit "Mark ready" click
-- (e.g. staff handed it over the moment it was done) doesn't silently
-- no-op the same way the pre-'Ready' bug did.
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
  if v_status not in ('Received', 'Preparing', 'Ready') then
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

-- Adds 'Preparing' to the refundable statuses and to the branch that
-- reverses place_redeemed_order's upfront stamp deduction on refund — a
-- $0 redeemed preorder that's had prep requested but isn't yet Ready still
-- needs its stamps restored correctly on refund.
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
  if v_status not in ('Received', 'Preparing', 'Ready', 'Collected') then
    raise exception 'Only a received, preparing, ready, or collected order can be refunded (this one is %)', v_status;
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
    elsif v_status in ('Received', 'Preparing', 'Ready') and v_free_qty > 0 and v_total = 0 and v_order_type = 'preorder' then
      update customers set stamps = stamps + 8 * v_free_qty, updated_at = now() where phone = v_phone;
    end if;
  end if;
end;
$$;

-- Adds order_type to what a customer can see about their own past orders,
-- so the client can hide the "start preparing" action for walk-ins (handed
-- over on the spot already, never sit in 'Received' waiting for pickup).
create or replace function get_my_orders(p_phone text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'date', date, 'items', items, 'total', total, 'status', status, 'orderType', order_type
  ) order by date desc), '[]'::jsonb)
  from orders
  where phone = p_phone
    and exists (
      select 1 from customers c
      where c.phone = p_phone and c.access_token is not null and c.access_token = p_token
    );
$$;

grant execute on function get_my_orders(text, text) to anon;
