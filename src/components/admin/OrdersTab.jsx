import { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import { exportToExcel } from '../../lib/exportXlsx.js';
import Overlay from '../Overlay.jsx';
import WalkinOrderSheet from './WalkinOrderSheet.jsx';
import OrderDetailSheet from './OrderDetailSheet.jsx';
import StatusBadge from './StatusBadge.jsx';

const TYPE_FILTERS = [{ key: 'all', label: 'All types' }, { key: 'preorder', label: 'Preorder' }, { key: 'walkin', label: 'Walk-in' }];
const STATUS_FILTERS = [{ key: 'all', label: 'All statuses' }, { key: 'Received', label: 'Received' }, { key: 'Collected', label: 'Collected' }, { key: 'Refunded', label: 'Refunded' }, { key: 'Payment failed', label: 'Payment failed' }];

// <input type="date"> gives/wants "YYYY-MM-DD" in local time.
function toLocalDateStr(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function OrdersTab() {
  const { orders } = useMoocha();
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

  const pendingWalkins = orders.filter(o => o.status === 'Received' && o.orderType === 'walkin').length;
  const pendingPreorders = orders.filter(o => o.status === 'Received' && o.orderType !== 'walkin').length;
  const rowClass = (o) => o.status !== 'Received' ? '' : (o.orderType === 'walkin' ? 'pending-walkin' : 'pending-preorder');

  // Exports exactly what's currently filtered/searched — "today's walk-ins"
  // or "this week's preorders" just works by filtering first, then
  // exporting. Two sheets: one row per order for a quick revenue total,
  // and one row per line item (money/qty as real numbers, not "$x.xx"
  // strings) for anything that needs a pivot table — that's what actually
  // saves re-typing versus a screenshot or a raw data dump.
  const exportOrders = () => {
    const orderRows = filtered.map(o => ({
      'Order #': o.id,
      'Date': new Date(o.date).toLocaleString(),
      'Type': o.orderType === 'walkin' ? 'Walk-in' : 'Preorder',
      'Status': o.status,
      'Collected At': o.collectedAt ? new Date(o.collectedAt).toLocaleString() : '',
      'Customer Name': o.name || '',
      'Phone': o.phone || '',
      'Items Summary': (o.items || []).map(i => `${i.name}${i.sugar ? ` (${i.sugar})` : ''} x${i.qty}`).join(', '),
      'Item Count': (o.items || []).reduce((s, i) => s + i.qty, 0),
      'Total': o.total,
      'Notes': o.notes || '',
      'Stripe Payment ID': o.stripeSessionId || '',
    }));
    const itemRows = filtered.flatMap(o => (o.items || []).map(i => ({
      'Order #': o.id,
      'Date': new Date(o.date).toLocaleDateString(),
      'Type': o.orderType === 'walkin' ? 'Walk-in' : 'Preorder',
      'Item': i.name,
      'Sugar': i.sugar || '',
      'Qty': i.qty,
      'Line Total': i.lineTotal,
      'Redeemed Free': i.redeemed ? 'Yes' : '',
    })));
    exportToExcel(`moocha-orders-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: 'Orders', rows: orderRows },
      { name: 'Order Items', rows: itemRows },
    ]);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="btn-secondary" style={{ marginBottom: 0, flex: 1 }} onClick={() => setAddingWalkin(true)}>+ New walk-in order</button>
        <button className="btn-secondary btn-compact" disabled={filtered.length === 0} onClick={exportOrders}>⬇ Export</button>
      </div>

      {(pendingWalkins > 0 || pendingPreorders > 0) && (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card" style={{ borderLeft: '4px solid var(--sun-deep)' }}>
            <div className="stat-num">{pendingWalkins}</div>
            <div className="stat-label">🚶 walk-in{pendingWalkins === 1 ? '' : 's'} waiting</div>
          </div>
          <div className="stat-card" style={{ borderLeft: '4px solid var(--green)' }}>
            <div className="stat-num">{pendingPreorders}</div>
            <div className="stat-label">📦 preorder{pendingPreorders === 1 ? '' : 's'} to collect</div>
          </div>
        </div>
      )}

      <input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by order #, name, phone, or item…" />
      <div className="search-row">
        <input className="search-input" type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        {dateFilter && <button className="btn-secondary btn-compact" onClick={() => setDateFilter('')}>Clear date</button>}
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
        <div className={`order-row ${rowClass(o)}`} style={{ alignItems: 'flex-start', cursor: 'pointer' }} key={o.id} onClick={() => setSelected(o)}>
          <div className="order-row-left">
            <div className="oid">#{o.id} · {new Date(o.date).toLocaleString()}</div>
            <div className="oitems">{o.name} · {o.phone}</div>
            <div className="sub" style={{ fontSize: 12, color: 'var(--brand)', marginTop: 2 }}>{o.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)' }}>{o.orderType === 'walkin' ? '🚶 Walk-in' : '📦 Preorder'}</span>
              <StatusBadge status={o.status} />
            </div>
          </div>
          <div className="order-row-right">
            <div className="oprice">{money(o.total)}</div>
            <span className="edit-link" style={{ display: 'block', marginTop: 8 }}>Details →</span>
          </div>
        </div>
      ))}

      <Overlay show={addingWalkin} onClose={() => setAddingWalkin(false)}>
        {addingWalkin && <WalkinOrderSheet onClose={() => setAddingWalkin(false)} />}
      </Overlay>
      <Overlay show={!!selected} onClose={() => setSelected(null)}>
        {selected && <OrderDetailSheet order={selected} onClose={() => setSelected(null)} />}
      </Overlay>
    </>
  );
}
