import React, { useState } from 'react';
import { useMoocha, DEFAULT_SUGAR_LEVELS, STAMP_GOAL } from '../../store.jsx';
import { money } from '../../lib/storage.js';

export default function WalkinOrderSheet({ onClose, onLogged }) {
  const { menu, customers, logWalkinOrder, showToast } = useMoocha();
  // Keyed by `${itemId}::${sugar}` so the same drink at different sugar
  // levels becomes separate lines, each independently adjustable.
  const [linesByKey, setLinesByKey] = useState({});
  const [pendingSugar, setPendingSugar] = useState({});
  const [redeemKey, setRedeemKey] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const allItems = Object.values(menu.categories).flat().filter(i => !i.isHidden);
  const itemById = Object.fromEntries(allItems.map(i => [i.id, i]));
  const sugarLevelsFor = (item) => (item.sugarLevels && item.sugarLevels.length) ? item.sugarLevels : DEFAULT_SUGAR_LEVELS;
  const remaining = (item) => item.walkinLimit == null ? null : Math.max(0, item.walkinLimit - (item.walkinSold || 0));
  const currentSugar = (item) => pendingSugar[item.id] || (sugarLevelsFor(item).includes('50%') ? '50%' : sugarLevelsFor(item)[0]);
  const qtyForItem = (itemId) => Object.values(linesByKey).filter(l => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);

  const addUnit = (item, sugar) => {
    const cap = remaining(item);
    if (cap != null && qtyForItem(item.id) + 1 > cap) {
      const left = cap - qtyForItem(item.id);
      showToast(left > 0 ? `Only ${left} left for walk-in` : 'No more left for walk-in this week');
      return;
    }
    const key = `${item.id}::${sugar}`;
    setLinesByKey(prev => ({ ...prev, [key]: { itemId: item.id, name: item.name, price: item.price, sugar, qty: (prev[key]?.qty || 0) + 1 } }));
  };

  const removeUnit = (key) => {
    setLinesByKey(prev => {
      const cur = prev[key];
      if (!cur) return prev;
      if (cur.qty <= 1) {
        const next = { ...prev };
        delete next[key];
        if (redeemKey === key) setRedeemKey(null);
        return next;
      }
      return { ...prev, [key]: { ...cur, qty: cur.qty - 1 } };
    });
  };

  const matchedCustomer = customers.find(c => c.phone === phone.trim());
  const customerStamps = matchedCustomer?.stamps || 0;
  const canRedeem = !!phone.trim() && customerStamps >= STAMP_GOAL;
  const toggleRedeem = (key) => setRedeemKey(prev => prev === key ? null : key);

  const lineEntries = Object.entries(linesByKey);
  const lines = lineEntries.map(([key, l]) => {
    const isRedeemed = canRedeem && redeemKey === key;
    const paidQty = isRedeemed ? l.qty - 1 : l.qty;
    return { itemId: l.itemId, name: l.name, sugar: l.sugar, qty: l.qty, lineTotal: l.price * paidQty, ...(isRedeemed ? { redeemed: true } : {}) };
  });
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);

  const submit = async () => {
    if (lines.length === 0) { showToast('Add at least one item'); return; }
    setBusy(true);
    const { error } = await logWalkinOrder({
      id: 'W' + Date.now(), name: name.trim(), phone: phone.trim(), items: lines, total, notes: notes.trim(),
    });
    setBusy(false);
    if (error) { showToast(error.message || 'Could not log this order'); return; }
    showToast('Walk-in order logged ✓');
    onLogged?.();
    onClose();
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">New walk-in order</div>
      <div className="sheet-sub">Logged as Received — mark it collected once handed over to award the stamp.</div>

      <div className="field"><label>Customer name (optional)</label><input value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field"><label>Phone (optional — needed for a stamp)</label><input value={phone} onChange={e => { setPhone(e.target.value); setRedeemKey(null); }} inputMode="tel" /></div>
      {canRedeem && (
        <div className="section-note" style={{ marginTop: -8, marginBottom: 12, color: 'var(--green-dark)', fontWeight: 800 }}>
          🎁 {customerStamps} stamps — eligible for a free drink! Tap "make 1 free" on a line below.
        </div>
      )}

      {allItems.map(item => {
        const cap = remaining(item);
        const totalQty = qtyForItem(item.id);
        const soldOutHere = item.soldout || cap === 0;
        const atCap = cap != null && totalQty >= cap;
        return (
          <div className="admin-item-row" key={item.id}>
            <div className="admin-item-top">
              <div>
                <div className="admin-item-name">{item.name}</div>
                <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>
                  {money(item.price)} {soldOutHere ? '· sold out' : (cap != null ? `· ${cap - totalQty} left` : '')}
                </div>
              </div>
              <button className="btn-secondary btn-compact" disabled={soldOutHere || atCap} onClick={() => addUnit(item, currentSugar(item))}>+ Add</button>
            </div>
            <div className="opt-row" style={{ marginTop: 10 }}>
              {sugarLevelsFor(item).map(level => (
                <button key={level} className={`opt-chip ${currentSugar(item) === level ? 'selected' : ''}`} onClick={() => setPendingSugar(prev => ({ ...prev, [item.id]: level }))}>{level}</button>
              ))}
            </div>
          </div>
        );
      })}

      {lineEntries.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 16 }}>Order so far</div>
          {lineEntries.map(([key, l]) => (
            <div className="cart-line" key={key}>
              <div className="cart-line-top"><span>{l.name} · {l.sugar}</span><span>{money(redeemKey === key ? l.price * Math.max(0, l.qty - 1) : l.price * l.qty)}</span></div>
              <div className="cart-line-bottom">
                <div className="mini-qty">
                  <button className="mini-btn" onClick={() => removeUnit(key)}>−</button>
                  <span>{l.qty}</span>
                  <button className="mini-btn" onClick={() => addUnit(itemById[l.itemId], l.sugar)}>+</button>
                </div>
                {canRedeem && <span className="edit-link" onClick={() => toggleRedeem(key)}>{redeemKey === key ? '🎁 1 free ✓' : '🎁 make 1 free'}</span>}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="field" style={{ marginTop: 16 }}><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>

      <div className="summary-row total" style={{ marginBottom: 14 }}><span>Total</span><span>{money(total)}</span></div>
      <button className="btn-primary" disabled={busy || lines.length === 0} onClick={submit}><span>Log order</span><span>{money(total)}</span></button>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
    </>
  );
}
