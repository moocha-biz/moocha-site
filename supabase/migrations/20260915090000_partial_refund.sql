-- Lets staff issue a partial Stripe refund (e.g. one missing item out of a
-- multi-item order, or a goodwill discount) without refunding the whole
-- order. Unlike refund_order() — which is an all-or-nothing "this order
-- never happened" reversal that flips status to Refunded and reverses
-- stamps/stock — a partial refund is ambiguous about *which* item(s) it
-- covers, so it deliberately does NOT touch status, stamps, or stock.
-- Staff adjust those by hand (menu editor / customer stamps) if a partial
-- refund actually corresponds to a specific missing item. Multiple partial
-- refunds accumulate in the array; Stripe itself is the source of truth for
-- rejecting a refund that would exceed what's left on the charge.
alter table orders add column if not exists partial_refunds jsonb not null default '[]'::jsonb;

create or replace function log_partial_refund(p_id text, p_amount numeric, p_refund_id text, p_reason text default null)
returns void
language plpgsql
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be positive';
  end if;
  update orders
  set partial_refunds = partial_refunds || jsonb_build_object(
    'amount', p_amount,
    'refundId', p_refund_id,
    'reason', nullif(p_reason, ''),
    'refundedBy', auth.email(),
    'refundedAt', now()
  )
  where id = p_id;
  if not found then
    raise exception 'Order not found';
  end if;
end;
$$;

grant execute on function log_partial_refund(text, numeric, text, text) to authenticated;
