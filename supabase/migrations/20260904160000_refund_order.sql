-- Refund flow for admin. Two ways in:
--   * A Stripe-paid preorder (orders.stripe_session_id is set) is refunded
--     by the new refund-order edge function, which calls stripe.refunds
--     first (using the service-role key, same as the webhook) and only
--     calls refund_order() below once Stripe itself confirms the money
--     actually moved back.
--   * A cash walk-in order (no stripe_session_id — nothing for Stripe to
--     reverse) is refunded straight from the admin UI, calling
--     refund_order() directly.
-- Both paths land on the same DB-side effects: flip status, and reverse
-- whatever stock/stamp booking happened at order-creation/collection time,
-- mirroring (in reverse) log_walkin_order / the webhook's
-- record_preorder_sale / mark_order_collected.

alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists refund_id text;

create or replace function refund_order(p_id text, p_refund_id text default null)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_order_type text;
  v_phone text;
  v_items jsonb;
  v_redeemed boolean;
  li jsonb;
  v_item_id text;
  v_qty integer;
begin
  select status, order_type, phone, items into v_status, v_order_type, v_phone, v_items
  from orders where id = p_id;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  -- 'Payment failed' never booked stock or a stamp (the webhook only does
  -- that on checkout.session.completed), and an already-'Refunded' order
  -- would double-reverse stock/stamps if this ran a second time.
  if v_status not in ('Received', 'Collected') then
    raise exception 'Only a received or collected order can be refunded (this one is %)', v_status;
  end if;

  update orders set status = 'Refunded', refunded_at = now(), refund_id = p_refund_id where id = p_id;

  -- Reverses whichever stock counter was booked at order-creation time
  -- (preorder_sold by the Stripe webhook, walkin_sold by log_walkin_order)
  -- so a refunded item's stock becomes sellable again. greatest(...,0)
  -- guards against a stray double-refund attempt taking a counter negative.
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

  -- A loyalty stamp is only ever given once an order reaches 'Collected'
  -- (see mark_order_collected) — a still-'Received' order never touched
  -- stamps, so there's nothing to undo for it.
  if v_status = 'Collected' and v_phone is not null and v_phone <> '' then
    select coalesce(bool_or(coalesce((it->>'redeemed')::boolean, false)), false) into v_redeemed
    from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) it;

    update customers set
      stamps = greatest(stamps - 1 + (case when v_redeemed then 8 else 0 end), 0),
      updated_at = now()
    where phone = v_phone;
  end if;
end;
$$;

-- Staff-only: relies on the "staff all orders"/"staff all customers" RLS
-- policies (for all to authenticated using (true)) from the auth lockdown
-- migration to actually restrict who this can touch — same as
-- mark_order_collected/log_walkin_order, this function is invoker-rights,
-- not security definer, so it's still bound by those policies.
grant execute on function refund_order(text, text) to authenticated;
