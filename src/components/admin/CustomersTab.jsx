import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import Overlay from '../Overlay.jsx';
import CustomerDetailSheet from './CustomerDetailSheet.jsx';

export default function CustomersTab() {
  const { customers } = useMoocha();
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');

  if (!customers || customers.length === 0) return <div className="empty-state">No customers yet.</div>;
  const q = query.trim().toLowerCase();
  const rows = [...customers]
    .filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <>
      <input
        value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or phone…"
        style={{ width: '100%', border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 14, padding: '11px 14px', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)', marginBottom: 14 }}
      />
      {rows.length === 0 && <div className="empty-state">No customers match "{query}".</div>}
      {rows.map(c => (
        <div className="table-row" style={{ alignItems: 'center', cursor: 'pointer' }} key={c.phone} onClick={() => setSelected(c)}>
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
