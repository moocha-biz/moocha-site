import React from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';

export default function OrderDetailSheet({ order, onClose }) {
  const { markOrderCollected, deleteOrder, showToast } = useMoocha();

  const collect = async () => {
    await markOrderCollected(order.id);
    showToast('Marked collected — stamp given ✓');
    onClose();
  };

  const remove = async () => {
    if (!window.confirm(`Delete order #${order.id}? This can't be undone.`)) return;
    await deleteOrder(order.id);
    showToast('Order deleted');
    onClose();
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">Order #{order.id}</div>
      <div className="sheet-sub">{order.orderType === 'walkin' ? 'Walk-in' : 'Preorder'} · {order.status}</div>

      <div className="field"><label>Customer</label><div className="admin-item-name">{order.name || '(no name)'}{order.phone ? ` · ${order.phone}` : ''}</div></div>

      <div className="field">
        <label>Ordered at</label>
        <div className="admin-item-name">{new Date(order.date).toLocaleString()}</div>
      </div>

      <div className="field">
        <label>Collected at</label>
        <div className="admin-item-name">{order.collectedAt ? new Date(order.collectedAt).toLocaleString() : '— not yet collected —'}</div>
      </div>

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
      <button className="btn-secondary" style={{ marginTop: order.status === 'Received' ? 8 : 16, color: '#b5563f', borderColor: '#FFDCD2' }} onClick={remove}>Delete order</button>
    </>
  );
}
