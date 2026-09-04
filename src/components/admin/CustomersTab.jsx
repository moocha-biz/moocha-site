import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { exportToExcel } from '../../lib/exportXlsx.js';
import Overlay from '../Overlay.jsx';
import CustomerDetailSheet from './CustomerDetailSheet.jsx';

export default function CustomersTab() {
  const { customers, orders } = useMoocha();
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');

  if (!customers || customers.length === 0) return <div className="empty-state">No customers yet.</div>;
  const q = query.trim().toLowerCase();
  const rows = [...customers]
    .filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Folds in order count/total spend per customer — saves the owner from
  // cross-referencing the orders sheet by hand for a mailing/loyalty list.
  const exportCustomers = () => {
    const exportRows = rows.map(c => {
      const mine = orders.filter(o => o.phone === c.phone);
      return {
        'Name': c.name || '',
        'Phone': c.phone,
        'Stamps': c.stamps || 0,
        'Orders': mine.length,
        'Total Spend': mine.reduce((s, o) => s + o.total, 0),
      };
    });
    exportToExcel(`moocha-customers-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Customers', rows: exportRows }]);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="search-input" style={{ flex: 1, marginBottom: 0 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or phone…" />
        <button className="btn-secondary btn-compact" onClick={exportCustomers}>⬇ Export</button>
      </div>
      {rows.length === 0 && <div className="empty-state">No customers match "{query}".</div>}
      {rows.map(c => (
        <div className="table-row" key={c.phone} onClick={() => setSelected(c)}>
          <div><div className="name">{c.name || '(no name)'}</div><div className="sub">{c.phone}</div></div>
          <div className="right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{c.stamps || 0} stamps <span style={{ color: 'var(--brand)' }}>→</span></div>
        </div>
      ))}
      <Overlay show={!!selected} onClose={() => setSelected(null)}>
        {selected && <CustomerDetailSheet customer={selected} onClose={() => setSelected(null)} />}
      </Overlay>
    </>
  );
}
