import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Overlay from '../Overlay.jsx';
import WalkinOrderSheet from './WalkinOrderSheet.jsx';
import OrderDetailSheet from './OrderDetailSheet.jsx';

const TYPE_FILTERS = [{ key: 'all', label: 'All types' }, { key: 'preorder', label: 'Preorder' }, { key: 'walkin', label: 'Walk-in' }];
const STATUS_FILTERS = [{ key: 'all', label: 'All statuses' }, { key: 'Received', label: 'Received' }, { key: 'Collected', label: 'Collected' }, { key: 'Payment failed', label: 'Payment failed' }];

// <input type="date"> gives/wants "YYYY-MM-DD" in local time.
function toLocalDateStr(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function OrdersTab() {
  const { orders, showToast } = useMoocha();
  const [addingWalkin, setAddingWalkin] = useState(false);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = orders.filter(o => {
    if (typeFilter !== 'all' && (o.orderType || 'preorder') !== typeFilter) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (dateFilter && toLocalDateStr(o.date) !== dateFilter) return false;
    if (!q) return true;
    const haystack = [o.id, o.name, o.phone, ...(o.items || []).map(i => i.name)].join(' ').toLowerCase();
    return haystack.includes(q);
  });

  return (
    <>
      <button className="btn-secondary" style={{ marginBottom: 14 }} onClick={() => setAddingWalkin(true)}>+ New walk-in order</button>

      <input
        value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by order #, name, phone, or item…"
        style={{ width: '100%', border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 14, padding: '11px 14px', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)', marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          style={{ flex: 1, border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 14, padding: '11px 14px', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)' }}
        />
        {dateFilter && <button className="btn-secondary" style={{ width: 'auto', padding: '0 16px', margin: 0 }} onClick={() => setDateFilter('')}>Clear date</button>}
      </div>
      <div className="opt-row" style={{ marginBottom: 6 }}>
        {TYPE_FILTERS.map(f => (
          <button key={f.key} className={`opt-chip ${typeFilter === f.key ? 'selected' : ''}`} onClick={() => setTypeFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="opt-row" style={{ marginBottom: 14 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f.key} className={`opt-chip ${statusFilter === f.key ? 'selected' : ''}`} onClick={() => setStatusFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {orders.length === 0 && <div className="empty-state">No orders yet.</div>}
      {orders.length > 0 && filtered.length === 0 && <div className="empty-state">No orders match your search/filters.</div>}
      {filtered.map(o => (
        <div className="order-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} key={o.id} onClick={() => setSelected(o)}>
          <div className="order-row-left">
            <div className="oid">#{o.id} · {new Date(o.date).toLocaleString()}</div>
            <div className="oitems">{o.name} · {o.phone}</div>
            <div className="sub" style={{ fontSize: 12, color: 'var(--brand)', marginTop: 2 }}>{o.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>
            <span className="order-status">{o.orderType === 'walkin' ? 'Walk-in' : 'Preorder'} · {o.status}</span>
          </div>
          <div className="order-row-right">
            <div className="oprice">{money(o.total)}</div>
            <span className="edit-link" style={{ display: 'block', marginTop: 8 }}>Details →</span>
          </div>
        </div>
      ))}

      <Overlay show={addingWalkin} onClose={() => setAddingWalkin(false)}>
        {addingWalkin && <WalkinOrderSheet onClose={() => setAddingWalkin(false)} onLogged={() => showToast('Walk-in order logged ✓')} />}
      </Overlay>
      <Overlay show={!!selected} onClose={() => setSelected(null)}>
        {selected && <OrderDetailSheet order={selected} onClose={() => setSelected(null)} />}
      </Overlay>
    </>
  );
}
