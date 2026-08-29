import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import Overlay from '../Overlay.jsx';
import CustomerDetailSheet from './CustomerDetailSheet.jsx';

export default function CustomersTab() {
  const { customers } = useMoocha();
  const [selected, setSelected] = useState(null);

  if (!customers || customers.length === 0) return <div className="empty-state">No customers yet.</div>;
  const rows = [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <>
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
