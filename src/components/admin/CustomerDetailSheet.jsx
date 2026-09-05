import { useState } from 'react';
import { useMoocha, STAMP_GOAL } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import StampCard from '../StampCard.jsx';
import StatusBadge from './StatusBadge.jsx';

const RECENT_ORDERS_SHOWN = 8;

export default function CustomerDetailSheet({ customer, onClose, onChanged }) {
  const { orders, setCustomerStamps, deleteCustomerRecord, fetchCustomers, setCustomers, generateClaimLink, showToast } = useMoocha();
  const [stampInput, setStampInput] = useState(customer.stamps || 0);
  const [claimLink, setClaimLink] = useState(null);
  const [generatingClaim, setGeneratingClaim] = useState(false);

  const shareClaimLink = async () => {
    setGeneratingClaim(true);
    const { code, error } = await generateClaimLink(customer.phone);
    setGeneratingClaim(false);
    if (error) { showToast(error); return; }
    setClaimLink(`${window.location.origin}/rewards?claim=${code}`);
  };

  const copyClaimLink = async () => {
    try { await navigator.clipboard.writeText(claimLink); showToast('Link copied ✓'); }
    catch { showToast('Could not copy — select and copy it manually'); }
  };

  // `orders` is already fetched newest-first, so slicing here is enough —
  // no need to re-sort per customer.
  const mine = orders.filter(o => o.phone === customer.phone);
  const stats = { count: mine.length, spend: mine.reduce((s, o) => s + o.total, 0) };

  const nudgeStamps = (delta) => setStampInput(prev => Math.min(STAMP_GOAL, Math.max(0, (parseInt(prev, 10) || 0) + delta)));

  const save = async () => {
    const val = parseInt(stampInput, 10);
    if (isNaN(val) || val < 0 || val > STAMP_GOAL) { showToast(`Enter a stamp count between 0 and ${STAMP_GOAL}`); return; }
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
    showToast('Customer deleted ✓');
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">{customer.name || '(no name)'}</div>
      <div className="sheet-sub">{customer.phone} · {stats.count} orders · {money(stats.spend)} spent</div>
      <div style={{ marginBottom: 18 }}>
        <StampCard stamps={customer.stamps || 0} flipEnabled={false} rewardMessage="🎉 free drink ready to redeem" />
      </div>

      <div className="field">
        <label>Link their stamps to the website</label>
        <div className="sub" style={{ color: 'var(--brand)', marginBottom: 8 }}>
          For a customer who's only ever ordered in person — this generates a one-time link (valid 15 minutes) that
          opens their My Rewards page on their own phone. Send it however's easiest while they're with you.
        </div>
        {!claimLink && (
          <button className="btn-secondary" style={{ marginBottom: 0 }} disabled={generatingClaim} onClick={shareClaimLink}>
            {generatingClaim ? 'Generating…' : 'Generate rewards link'}
          </button>
        )}
        {claimLink && (
          <>
            <input readOnly value={claimLink} onFocus={e => e.target.select()} style={{ fontSize: 12, wordBreak: 'break-all' }} />
            <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
              <span className="edit-link" onClick={copyClaimLink}>Copy link</span>
              <span className="edit-link" onClick={shareClaimLink}>Generate new one</span>
            </div>
          </>
        )}
      </div>

      <div className="field">
        <label>Set exact stamp count (goal: {STAMP_GOAL})</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="mini-btn" disabled={(parseInt(stampInput, 10) || 0) <= 0} onClick={() => nudgeStamps(-1)}>−</button>
          <input
            type="number" min={0} max={STAMP_GOAL} style={{ flex: 1, textAlign: 'center' }} value={stampInput}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') { setStampInput(''); return; }
              setStampInput(Math.min(STAMP_GOAL, Math.max(0, parseInt(raw, 10) || 0)));
            }}
          />
          <button type="button" className="mini-btn" disabled={(parseInt(stampInput, 10) || 0) >= STAMP_GOAL} onClick={() => nudgeStamps(1)}>+</button>
        </div>
      </div>
      <button className="btn-primary" onClick={save}><span>Save stamps</span><span>→</span></button>

      <div className="section-label" style={{ marginTop: 20 }}>Order history</div>
      {mine.length === 0 && <div className="sub" style={{ color: 'var(--brand)' }}>No orders yet.</div>}
      {mine.slice(0, RECENT_ORDERS_SHOWN).map(o => (
        <div className="table-row" key={o.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
          <div>
            <div className="name" style={{ fontSize: 12.5 }}>{new Date(o.date).toLocaleDateString()} · #{o.id}</div>
            <div className="sub">{(o.items || []).map(i => `${i.name} x${i.qty}`).join(', ')}</div>
          </div>
          <div className="right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span>{money(o.total)}</span>
            <StatusBadge status={o.status} />
          </div>
        </div>
      ))}
      {mine.length > RECENT_ORDERS_SHOWN && (
        <div className="sub" style={{ color: 'var(--brand)', textAlign: 'center', marginTop: 4 }}>
          + {mine.length - RECENT_ORDERS_SHOWN} more — see Orders tab
        </div>
      )}

      {/* A small text link, not a full-width button — delete is rare and
          destructive, and shouldn't share visual weight with Save above. */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <span className="remove-link" onClick={remove}>Delete this customer</span>
      </div>
    </>
  );
}
