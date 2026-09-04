import React from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';

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

  const refund = async () => {
    const verb = order.stripeSessionId ? `refund ${money(order.total)} via Stripe for` : 'mark refunded (cash)';
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
      <div className="sheet-sub">{order.orderType === 'walkin' ? 'Walk-in' : 'Preorder'} · {order.status}</div>

      <OrderProgress status={order.status} />

      <div className="field"><label>Customer</label><div className="admin-item-name">{order.name || '(no name)'}{order.phone ? ` · ${order.phone}` : ''}</div></div>

      <div className="field">
        <label>Ordered at</label>
        <div className="admin-item-name">{new Date(order.date).toLocaleString()}</div>
      </div>

      <div className="field">
        <label>Collected at</label>
        <div className="admin-item-name">{order.collectedAt ? new Date(order.collectedAt).toLocaleString() : '— not yet collected —'}</div>
      </div>

      <div className="field">
        <label>Payment</label>
        <div className="admin-item-name" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
          {order.stripeSessionId ? `Stripe · ${order.stripeSessionId}` : 'Cash / no payment record (walk-in)'}
        </div>
      </div>

      {order.status === 'Refunded' && (
        <div className="field">
          <label>Refunded at</label>
          <div className="admin-item-name" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
            {order.refundedAt ? new Date(order.refundedAt).toLocaleString() : '—'}
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
          {refunding ? 'Refunding…' : order.stripeSessionId ? 'Refund via Stripe' : 'Mark refunded (cash)'}
        </button>
      )}
      <button className="btn-secondary" style={{ marginTop: canRefund ? 8 : 16, color: '#b5563f', borderColor: '#FFDCD2' }} onClick={remove}>Delete order</button>
    </>
  );
}
