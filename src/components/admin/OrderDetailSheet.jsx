import React from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import { edgeFunctionErrorMessage } from '../../lib/edgeFunctionError.js';
import StatusBadge, { Badge } from './StatusBadge.jsx';

// A paid/logged order only ever exists as a row once payment (or the
// walk-in log) already succeeded, so there's no meaningful "awaiting
// payment" step to show here — the real flow is just Placed -> Collected.
// "Payment failed" is a separate dead-end (the checkout session expired
// before paying), so it gets its own banner instead of pretending to
// progress through the same two steps.
function OrderProgress({ status }) {
  if (status === 'Payment failed') {
    return (
      <div style={{ background: 'var(--blush)', color: '#8a3a2a', borderRadius: 14, padding: '12px 16px', marginBottom: 18, fontWeight: 800, fontFamily: "'Baloo 2'", textAlign: 'center', fontSize: 13 }}>
        Payment failed - checkout was never completed
      </div>
    );
  }
  if (status === 'Refunded') {
    return (
      <div style={{ background: 'var(--blush)', color: '#8a3a2a', borderRadius: 14, padding: '12px 16px', marginBottom: 18, fontWeight: 800, fontFamily: "'Baloo 2'", textAlign: 'center', fontSize: 13 }}>
        Refunded
      </div>
    );
  }
  const STEP_ORDER = { Received: 0, Preparing: 1, Ready: 2, Collected: 3 };
  const at = STEP_ORDER[status] ?? 0;
  const steps = [
    { label: 'Order placed', done: at >= 0 },
    { label: 'Preparing', done: at >= 1 },
    { label: 'Ready for pickup', done: at >= 2 },
    { label: 'Collected', done: at >= 3 },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', margin: '2px 0 20px 0' }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 12.5, flexShrink: 0,
              background: s.done ? 'var(--green)' : 'var(--mint)', color: s.done ? '#fff' : 'var(--brand)',
            }}>{s.done ? '✓' : i + 1}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: s.done ? 'var(--green-dark)' : 'var(--brand)', whiteSpace: 'nowrap' }}>{s.label}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 3, background: steps[i + 1].done ? 'var(--green)' : 'var(--mint)', margin: '11px 6px 0 6px', borderRadius: 2 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// Stripe's own dashboard is the source of truth for a payment — this just
// builds a direct deep link to it from the checkout session id, so staff
// don't have to search for it by hand. cs_test_... vs cs_live_... tells us
// which dashboard mode to link into.
function stripeDashboardUrl(sessionId) {
  const mode = sessionId.startsWith('cs_test_') ? 'test/' : '';
  return `https://dashboard.stripe.com/${mode}checkout/sessions/${sessionId}`;
}

function DetailRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, fontWeight: 700, color: '#5b6e54', padding: '3px 0' }}>
      <span style={{ color: 'var(--brand)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function PaymentField({ order }) {
  const { sb } = useMoocha();
  const [details, setDetails] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    if (!sb || !order.stripeSessionId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    sb.functions.invoke('get-order-payment', { body: { orderId: order.id } }).then(async ({ data, error: err }) => {
      if (cancelled) return;
      if (err || data?.error) { setError(await edgeFunctionErrorMessage(data, err, 'Could not load Stripe details')); }
      else setDetails(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [sb, order.id, order.stripeSessionId]);

  if (!order.stripeSessionId) {
    const isRedeemed = (order.items || []).some(it => it.redeemed);
    const label = isRedeemed
      ? 'Redeemed with stamps - no payment'
      : order.orderType === 'walkin'
        ? 'Cash / no payment record (walk-in)'
        : 'No payment record';
    return (
      <div className="field">
        <label>Payment</label>
        <div className="admin-item-name">{label}</div>
      </div>
    );
  }

  return (
    <div className="field">
      <label>Payment</label>
      <div style={{ background: 'var(--paper)', border: '2px solid var(--line)', borderRadius: 14, padding: '12px 14px' }}>
        {loading && <div style={{ fontSize: 12.5, color: 'var(--brand)', fontWeight: 700, fontStyle: 'italic' }}>Checking Stripe…</div>}
        {!loading && error && <div style={{ fontSize: 12.5, color: '#b5563f', fontWeight: 700 }}>{error}</div>}
        {!loading && details && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="admin-item-name" style={{ fontSize: 13.5 }}>
                {details.paymentMethodType ? details.paymentMethodType.toUpperCase() : 'Stripe'}
              </span>
              <Badge
                label={details.paymentStatus}
                style={details.paymentStatus === 'paid' ? { background: 'var(--green)', color: '#fff' } : { background: 'var(--sun)', color: '#8a5b05' }}
              />
            </div>
            <DetailRow label="Reference" value={details.paynowReference} />
            <DetailRow label="Email" value={details.customerEmail} />
            <DetailRow label="Refunded" value={details.refunded ? money((details.amountRefunded || 0) / 100) : null} />
            <DetailRow label="Net after fees" value={details.netAmount != null ? `${money(details.netAmount / 100)} (fee ${money((details.feeAmount || 0) / 100)})` : null} />
            {details.disputed && <DetailRow label="Disputed" value="Yes" />}
            <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
              {details.receiptUrl && <a className="edit-link" href={details.receiptUrl} target="_blank" rel="noreferrer">Receipt →</a>}
              <a className="edit-link" href={stripeDashboardUrl(order.stripeSessionId)} target="_blank" rel="noreferrer">Stripe Dashboard →</a>
            </div>
          </>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--brand)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 8, opacity: 0.8 }}>
          {order.stripeSessionId}
        </div>
      </div>
    </div>
  );
}

export default function OrderDetailSheet({ order, onClose }) {
  const { markOrderCollected, markOrderPreparing, markOrderReady, deleteOrder, refundOrder, showToast } = useMoocha();
  const [refunding, setRefunding] = React.useState(false);
  const [marking, setMarking] = React.useState(false);
  const [startingPrep, setStartingPrep] = React.useState(false);
  const [holdingDelete, setHoldingDelete] = React.useState(false);
  const deleteHoldTimer = React.useRef(null);
  const canRefund = order.status === 'Received' || order.status === 'Preparing' || order.status === 'Ready' || order.status === 'Collected';

  React.useEffect(() => () => clearTimeout(deleteHoldTimer.current), []);

  const NOTIFY_SKIP_REASONS = {
    'no phone': 'Marked ready - no phone on file, let them know in person',
    'not linked': "Marked ready - not on Telegram, let them know in person",
    'send failed': 'Marked ready - Telegram DM failed to send, let them know in person',
  };

  const startPreparing = async () => {
    setStartingPrep(true);
    await markOrderPreparing(order.id);
    setStartingPrep(false);
    showToast('Marked preparing ✓');
    onClose();
  };

  const ready = async () => {
    setMarking(true);
    const { notified, reason } = await markOrderReady(order.id);
    setMarking(false);
    showToast(notified ? 'Marked ready - customer notified on Telegram ✓' : (NOTIFY_SKIP_REASONS[reason] || 'Marked ready ✓'));
    onClose();
  };

  const collect = async () => {
    await markOrderCollected(order.id);
    showToast('Marked collected - stamps given ✓');
    onClose();
  };

  const remove = async () => {
    if (!window.confirm(`Delete order #${order.id}? This can't be undone.`)) return;
    await deleteOrder(order.id);
    showToast('Order deleted ✓');
    onClose();
  };

  // Delete is irreversible, so a plain tap isn't enough on mobile where it's
  // easy to fat-finger next to "Partial refund…" — hold ~550ms to arm it,
  // then the window.confirm above is the final safety net.
  const startDeleteHold = () => {
    setHoldingDelete(true);
    deleteHoldTimer.current = setTimeout(() => {
      setHoldingDelete(false);
      remove();
    }, 550);
  };
  const cancelDeleteHold = () => {
    clearTimeout(deleteHoldTimer.current);
    setHoldingDelete(false);
  };

  const isRedeemed = (order.items || []).some(it => it.redeemed);
  const refund = async () => {
    const verb = order.stripeSessionId
      ? `refund ${money(order.total)} via Stripe for`
      : isRedeemed ? 'cancel and give back the stamps used on' : 'mark refunded (cash) for';
    if (!window.confirm(`Really ${verb} order #${order.id}? This can't be undone.`)) return;
    setRefunding(true);
    const { error } = await refundOrder(order);
    setRefunding(false);
    if (error) { showToast(error); return; }
    showToast('Order refunded ✓');
    onClose();
  };

  // A specific amount (e.g. one missing item) rather than voiding the whole
  // order — doesn't touch status/stamps/stock, see refund-order/index.ts.
  // Doesn't close the sheet after, since the order's still active and staff
  // may want to see the updated refund history right away.
  const partialRefund = async () => {
    const raw = window.prompt(`Partial refund amount for order #${order.id} (max ${money(order.total)}):`);
    if (raw == null) return;
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter a valid amount'); return; }
    const reason = window.prompt('Reason (optional, shown in the order history):') || '';
    if (!window.confirm(`Really refund ${money(amount)} via Stripe for order #${order.id}? This can't be undone.`)) return;
    setRefunding(true);
    const { error } = await refundOrder(order, { amount, reason });
    setRefunding(false);
    if (error) { showToast(error); return; }
    showToast(`${money(amount)} refunded ✓`);
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">Order #{order.id}</div>
      <div className="sheet-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{order.orderType === 'walkin' ? 'Walk-in' : 'Preorder'}</span>
        <StatusBadge status={order.status} />
      </div>

      <OrderProgress status={order.status} />

      <div className="field"><label>Customer</label><div className="admin-item-name">{order.name || '(no name)'}{order.phone ? ` · ${order.phone}` : ''}</div></div>

      <div className="field">
        <label>Ordered at</label>
        <div className="admin-item-name">{new Date(order.date).toLocaleString()}</div>
      </div>

      {/* Stages up to and including the last one that actually happened get
          their own full label+timestamp field; a skipped earlier stage
          (e.g. a walk-in never has "prep requested") is just omitted, not
          shown as pending. Everything after that last-completed point is
          still pending by definition (they're sequential) and would
          otherwise be three near-identical "hasn't happened" fields, so
          they collapse into one compact grey line naming the next one. */}
      {(() => {
        const stages = [
          { label: 'Prep requested at', at: order.prepRequestedAt, extra: order.prepRequestedBy ? ` · ${order.prepRequestedBy}` : (order.prepRequestedAt ? ' · by customer' : ''), pendingLabel: 'Not yet in preparation' },
          { label: 'Ready at', at: order.readyAt, extra: order.readyBy ? ` · ${order.readyBy}` : '', pendingLabel: 'Not yet ready' },
          { label: 'Collected at', at: order.collectedAt, extra: order.collectedBy ? ` · ${order.collectedBy}` : '', pendingLabel: 'Not yet collected' },
        ];
        const lastCompletedIdx = stages.reduce((acc, s, i) => (s.at ? i : acc), -1);
        return (
          <>
            {stages.map((s, i) => (i <= lastCompletedIdx && s.at ? (
              <div className="field" key={s.label}>
                <label>{s.label}</label>
                <div className="admin-item-name">{new Date(s.at).toLocaleString()}{s.extra}</div>
              </div>
            ) : null))}
            {lastCompletedIdx < stages.length - 1 && (
              <div className="field-status-pending">{stages[lastCompletedIdx + 1].pendingLabel}</div>
            )}
          </>
        );
      })()}

      <PaymentField order={order} />

      {order.status === 'Refunded' && (
        <div className="field">
          <label>Refunded at</label>
          <div className="admin-item-name" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
            {order.refundedAt ? new Date(order.refundedAt).toLocaleString() : '-'}
            {order.refundedBy ? ` · ${order.refundedBy}` : ''}
            {order.refundId ? ` · ${order.refundId}` : ''}
          </div>
        </div>
      )}

      {/* Independent of status - a partially refunded order stays
          Received/Preparing/Ready/Collected, only a full refund flips it
          to Refunded (see refund-order/index.ts). */}
      {(order.partialRefunds || []).length > 0 && (
        <div className="field">
          <label>Partial refunds</label>
          {order.partialRefunds.map((pr, i) => (
            <div className="admin-item-name" key={i} style={{ fontSize: 12.5, wordBreak: 'break-all', marginBottom: 4 }}>
              {money(pr.amount)}{pr.reason ? ` — ${pr.reason}` : ''}
              <br />
              {pr.refundedAt ? new Date(pr.refundedAt).toLocaleString() : ''}
              {pr.refundedBy ? ` · ${pr.refundedBy}` : ''}
              {pr.refundId ? ` · ${pr.refundId}` : ''}
            </div>
          ))}
        </div>
      )}

      {order.notes && (
        <div className="field"><label>Notes</label><div className="admin-item-name" style={{ fontWeight: 600 }}>{order.notes}</div></div>
      )}

      <div className="section-label" style={{ marginTop: 10 }}>Items</div>
      {(order.items || []).map((it, i) => (
        <div className="summary-row" key={i}>
          <span>{it.name}{it.sugar ? ` · ${it.sugar}` : ''} x{it.qty}{it.redeemed ? ` · ${it.freeQty || 1} free` : ''}</span>
          <span>{money(it.lineTotal)}</span>
        </div>
      ))}
      <div className="summary-row total"><span>Total</span><span>{money(order.total)}</span></div>

      {/* Most walk-ins are handed straight over with no gap between "made"
          and "picked up", so this direct skip stays available — but a
          walk-in customer who's stepping away while it's made (see the
          "Mark ready" button below, now offered for walk-ins too) needs
          it, so it's no longer their only option. */}
      {order.status === 'Received' && order.orderType === 'walkin' && (
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={collect}><span>Mark collected</span><span>→</span></button>
      )}
      {/* Staff can flip Received -> Preparing themselves for a customer who
          calls in or asks in person instead of tapping the app's own
          "prepare my drink" button — same status either way, just a
          different starting point. Walk-ins never go through Preparing
          (their drink starts the moment it's logged, there's no advance
          queue to join) — secondary, not primary, since staff can still
          skip straight to "Mark ready" below without it. */}
      {order.status === 'Received' && order.orderType !== 'walkin' && (
        <button className="btn-secondary" style={{ marginTop: 16 }} disabled={startingPrep} onClick={startPreparing}>
          {startingPrep ? 'Marking preparing…' : 'Mark preparing (customer asked in person)'}
        </button>
      )}
      {/* Now available for walk-ins too, not just preorders — a walk-in
          customer who wants to step away while their drink is made can be
          notified over Telegram the same way a preorder customer is,
          instead of only ever handed over directly via "Mark collected"
          above. Secondary styling when shown alongside that direct-skip
          button (walk-in, still Received) since it's the less common
          choice there; primary on its own for a preorder, where it's the
          only way forward from Received/Preparing. */}
      {(order.status === 'Received' || order.status === 'Preparing') && (
        order.status === 'Received' && order.orderType === 'walkin' ? (
          <button className="btn-secondary" style={{ marginTop: 8 }} disabled={marking} onClick={ready}>
            {marking ? 'Marking ready…' : 'Mark ready (notify when I step away)'}
          </button>
        ) : (
          <button className="btn-primary" style={{ marginTop: order.status === 'Received' ? 8 : 16 }} disabled={marking} onClick={ready}>
            <span>{marking ? 'Marking ready…' : 'Mark ready'}</span><span>→</span>
          </button>
        )
      )}
      {order.status === 'Ready' && <button className="btn-primary" style={{ marginTop: 16 }} onClick={collect}><span>Mark collected</span><span>→</span></button>}
      {/* Refund/delete are destructive and sit right below the workflow
          buttons above (mark ready/collected) — a divider + extra gap
          keeps a misclick between them from being an easy mistake. Both
          actions still require a window.confirm() before anything happens. */}
      <div className="order-danger-zone">
        {canRefund && (
          <button className="btn-secondary" style={{ marginTop: 0, color: '#b5563f', borderColor: '#FFDCD2' }} disabled={refunding} onClick={refund}>
            {refunding ? 'Refunding…' : order.stripeSessionId ? 'Refund via Stripe' : isRedeemed ? 'Cancel & refund stamps' : 'Mark refunded (cash)'}
          </button>
        )}
        {canRefund && order.stripeSessionId && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <span className="edit-link" onClick={partialRefund}>Partial refund…</span>
          </div>
        )}
        {/* A small, muted text link — not a full-width button like refund,
            and deliberately smaller than "Partial refund…" above it, since
            delete is rare, irreversible, and shouldn't share visual weight
            with the much more common refund action. Requires a press-and-hold
            (not just a tap) before the confirm dialog even appears. */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <span
            className={`remove-link remove-link-hold${holdingDelete ? ' holding' : ''}`}
            onPointerDown={startDeleteHold}
            onPointerUp={cancelDeleteHold}
            onPointerLeave={cancelDeleteHold}
            onPointerCancel={cancelDeleteHold}
          >
            {holdingDelete ? 'Keep holding to delete…' : 'Hold to delete order'}
          </span>
        </div>
      </div>
    </>
  );
}
