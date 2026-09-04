import React from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
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
        ⚠️ Payment failed — checkout was never completed
      </div>
    );
  }
  if (status === 'Refunded') {
    return (
      <div style={{ background: 'var(--blush)', color: '#8a3a2a', borderRadius: 14, padding: '12px 16px', marginBottom: 18, fontWeight: 800, fontFamily: "'Baloo 2'", textAlign: 'center', fontSize: 13 }}>
        ↩️ Refunded
      </div>
    );
  }
  const collected = status === 'Collected';
  const steps = [{ label: 'Order placed', done: true }, { label: 'Collected', done: collected }];
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
    sb.functions.invoke('get-order-payment', { body: { orderId: order.id } }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err || data?.error) { setError(data?.error || err?.message || 'Could not load Stripe details'); }
      else setDetails(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [sb, order.id, order.stripeSessionId]);

  if (!order.stripeSessionId) {
    const isRedeemed = (order.items || []).some(it => it.redeemed);
    const label = isRedeemed
      ? '🎁 Redeemed with stamps — no payment'
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
        {!loading && error && <div style={{ fontSize: 12.5, color: '#b5563f', fontWeight: 700 }}>⚠️ {error}</div>}
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
            {details.disputed && <DetailRow label="⚠️ Disputed" value="Yes" />}
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
  const { markOrderCollected, deleteOrder, refundOrder, showToast } = useMoocha();
  const [refunding, setRefunding] = React.useState(false);
  const canRefund = order.status === 'Received' || order.status === 'Collected';

  const collect = async () => {
    await markOrderCollected(order.id);
    showToast('Marked collected — stamp given ✓');
    onClose();
  };

  const remove = async () => {
    if (!window.confirm(`Delete order #${order.id}? This can't be undone.`)) return;
    await deleteOrder(order.id);
    showToast('Order deleted ✓');
    onClose();
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

      <div className="field">
        <label>Collected at</label>
        <div className="admin-item-name">
          {order.collectedAt ? new Date(order.collectedAt).toLocaleString() : '— not yet collected —'}
          {order.collectedBy ? ` · ${order.collectedBy}` : ''}
        </div>
      </div>

      <PaymentField order={order} />

      {order.status === 'Refunded' && (
        <div className="field">
          <label>Refunded at</label>
          <div className="admin-item-name" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
            {order.refundedAt ? new Date(order.refundedAt).toLocaleString() : '—'}
            {order.refundedBy ? ` · ${order.refundedBy}` : ''}
            {order.refundId ? ` · ${order.refundId}` : ''}
          </div>
        </div>
      )}

      {order.notes && (
        <div className="field"><label>Notes</label><div className="admin-item-name" style={{ fontWeight: 600 }}>{order.notes}</div></div>
      )}

      <div className="section-label" style={{ marginTop: 10 }}>Items</div>
      {(order.items || []).map((it, i) => (
        <div className="summary-row" key={i}>
          <span>{it.name}{it.sugar ? ` · ${it.sugar}` : ''} x{it.qty}{it.redeemed ? ' · 🎁 1 free' : ''}</span>
          <span>{money(it.lineTotal)}</span>
        </div>
      ))}
      <div className="summary-row total"><span>Total</span><span>{money(order.total)}</span></div>

      {order.status === 'Received' && <button className="btn-primary" style={{ marginTop: 16 }} onClick={collect}><span>Mark collected</span><span>→</span></button>}
      {canRefund && (
        <button className="btn-secondary" style={{ marginTop: 8, color: '#b5563f', borderColor: '#FFDCD2' }} disabled={refunding} onClick={refund}>
          {refunding ? 'Refunding…' : order.stripeSessionId ? 'Refund via Stripe' : isRedeemed ? 'Cancel & refund stamps' : 'Mark refunded (cash)'}
        </button>
      )}
      {/* A small text link, not a full-width button like refund — delete is
          rare and destructive, and shouldn't share visual weight with the
          much more common refund action right above it. */}
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <span className="remove-link" onClick={remove}>Delete order</span>
      </div>
    </>
  );
}
