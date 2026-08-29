import React, { useState } from 'react';
import { useMoocha, STAMP_GOAL } from '../../store.jsx';
import { money } from '../../lib/storage.js';

export default function CustomerDetailSheet({ customer, onClose, onChanged }) {
  const { orders, setCustomerStamps, deleteCustomerRecord, fetchCustomers, setCustomers, showToast } = useMoocha();
  const [stampInput, setStampInput] = useState(customer.stamps || 0);

  const stats = (() => {
    const mine = orders.filter(o => o.phone === customer.phone);
    return { count: mine.length, spend: mine.reduce((s, o) => s + o.total, 0) };
  })();

  const totalStamps = customer.stamps || 0;
  const progress = totalStamps > 0 && totalStamps % STAMP_GOAL === 0 ? STAMP_GOAL : totalStamps % STAMP_GOAL;
  const readyForReward = totalStamps > 0 && totalStamps % STAMP_GOAL === 0;

  const save = async () => {
    const val = parseInt(stampInput, 10);
    if (isNaN(val) || val < 0) { showToast('Enter a valid stamp count'); return; }
    await setCustomerStamps(customer.phone, val);
    setCustomers(await fetchCustomers());
    onClose();
    onChanged?.();
    showToast('Stamps updated ✓');
  };

  const remove = async () => {
    if (!window.confirm("Delete this customer record? Their past orders stay, but their stamp card resets.")) return;
    await deleteCustomerRecord(customer.phone);
    setCustomers(await fetchCustomers());
    onClose();
    onChanged?.();
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">{customer.name || '(no name)'}</div>
      <div className="sheet-sub">{customer.phone} · {stats.count} orders · {money(stats.spend)} spent</div>
      <div className="stamp-card" style={{ marginBottom: 18 }}>
        <div className="stamp-card-inner">
          <div className="stamp-card-goal">{progress} of {STAMP_GOAL} stamps</div>
          <div className="stamp-grid">
            {Array.from({ length: STAMP_GOAL }, (_, i) => (
              <div key={i} className={`stamp-slot ${i < progress ? 'filled' : ''}`}>
                {i < progress && <img src="/assets/logo-cow.png" alt="stamp" />}
              </div>
            ))}
          </div>
          {readyForReward && <div className="reward-banner">🎉 free drink ready to redeem</div>}
        </div>
      </div>
      <div className="field"><label>Set exact stamp count</label><input type="number" value={stampInput} onChange={e => setStampInput(e.target.value)} /></div>
      <button className="btn-primary" onClick={save}><span>Save stamps</span><span>→</span></button>
      <button className="btn-secondary" style={{ color: '#b5563f', borderColor: 'var(--blush-deep)', marginTop: 20 }} onClick={remove}>Delete this customer</button>
    </>
  );
}
