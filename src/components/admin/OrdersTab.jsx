import React from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';

export default function OrdersTab() {
  const { orders, deleteOrder, showToast } = useMoocha();

  const confirmDeleteOrder = async (id) => {
    if (!window.confirm(`Delete order #${id}? This can't be undone.`)) return;
    await deleteOrder(id);
    showToast('Order deleted');
  };

  if (orders.length === 0) return <div className="empty-state">No orders yet.</div>;

  return (
    <>
      {orders.map(o => (
        <div className="order-row" style={{ alignItems: 'flex-start' }} key={o.id}>
          <div className="order-row-left">
            <div className="oid">#{o.id} · {new Date(o.date).toLocaleString()}</div>
            <div className="oitems">{o.name} · {o.phone}</div>
            <div className="sub" style={{ fontSize: 12, color: 'var(--brand)', marginTop: 2 }}>{o.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>
            <span className="order-status">{o.status}</span>
          </div>
          <div className="order-row-right">
            <div className="oprice">{money(o.total)}</div>
            <button className="icon-btn danger" style={{ marginTop: 8 }} onClick={() => confirmDeleteOrder(o.id)}>✕</button>
          </div>
        </div>
      ))}
    </>
  );
}
