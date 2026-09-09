import { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useMoocha, DEFAULT_SUGAR_LEVELS, STAMP_GOAL } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import { buildPayNowPayload } from '../../lib/paynow.js';

export default function WalkinOrderSheet({ onClose, onLogged }) {
  const { menu, customers, logWalkinOrder, showToast } = useMoocha();
  // Keyed by `${itemId}::${sugar}` so the same drink at different sugar
  // levels becomes separate lines, each independently adjustable.
  const [linesByKey, setLinesByKey] = useState({});
  const [pendingSugar, setPendingSugar] = useState({});
  // Staff-picked free-unit counts, keyed the same as linesByKey. Clamped
  // against each line's qty and the redemption budget below (rawFreeQtyByKey
  // -> freeQtyByKey) so shrinking the cart never leaves a stale over-pick.
  const [rawFreeQtyByKey, setRawFreeQtyByKey] = useState({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [busyQr, setBusyQr] = useState(false);

  const allItems = Object.values(menu.categories).flat().filter(i => !i.isHidden);
  const itemById = Object.fromEntries(allItems.map(i => [i.id, i]));
  // Grouped by category (like the menu editor) rather than one long flat
  // list, so a menu with more than a handful of drinks stays scannable —
  // and filtered by the same search box, so staff can jump straight to a
  // drink by name during a rush instead of scrolling past everything else.
  const q = query.trim().toLowerCase();
  const categoryEntries = Object.keys(menu.categories).map(cat => ({
    cat,
    items: menu.categories[cat].filter(i => !i.isHidden && (!q || i.name.toLowerCase().includes(q))),
  })).filter(({ items }) => items.length > 0);
  const sugarLevelsFor = (item) => item.sugarLevels != null ? item.sugarLevels : DEFAULT_SUGAR_LEVELS;
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
        return next;
      }
      return { ...prev, [key]: { ...cur, qty: cur.qty - 1 } };
    });
  };

  const lineEntries = Object.entries(linesByKey);
  const cartQtyTotal = lineEntries.reduce((s, [, l]) => s + l.qty, 0);

  const matchedCustomer = customers.find(c => c.phone === phone.trim());
  const customerStamps = matchedCustomer?.stamps || 0;
  // Mirrors the online cart's crossing logic (store.jsx's totalFreeUnits) —
  // stamps already banked plus every drink in this walk-in order itself can
  // cross STAMP_GOAL, possibly more than once on a big order.
  const totalFreeUnits = !!phone.trim() && cartQtyTotal > 0
    ? Math.min(Math.floor((customerStamps + cartQtyTotal) / STAMP_GOAL), cartQtyTotal)
    : 0;
  const canRedeem = totalFreeUnits > 0;

  // Clamp staff picks to each line's current qty and to the redemption
  // budget, in that order, so a cart that shrank after picks were made
  // never over-claims free units.
  const freeQtyByKey = useMemo(() => {
    const map = {};
    let remainingBudget = totalFreeUnits;
    for (const [key, l] of lineEntries) {
      if (remainingBudget <= 0) break;
      const requested = Math.min(rawFreeQtyByKey[key] || 0, l.qty);
      const take = Math.min(requested, remainingBudget);
      if (take > 0) { map[key] = take; remainingBudget -= take; }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesByKey, rawFreeQtyByKey, totalFreeUnits]);
  const freeUsed = Object.values(freeQtyByKey).reduce((s, n) => s + n, 0);
  const freeRemaining = totalFreeUnits - freeUsed;

  // Tapping a line cycles its free-unit count 0 -> 1 -> ... -> cap -> 0,
  // where cap is however much of the remaining budget this line can still
  // claim (its own current pick included, so cycling back down releases
  // budget for other lines).
  const cycleFree = (key, lineQty) => {
    setRawFreeQtyByKey(prev => {
      const cur = prev[key] || 0;
      const cap = Math.min(lineQty, freeRemaining + cur);
      const next = cur >= cap ? 0 : cur + 1;
      const copy = { ...prev };
      if (next === 0) delete copy[key]; else copy[key] = next;
      return copy;
    });
  };

  const lines = lineEntries.map(([key, l]) => {
    const free = freeQtyByKey[key] || 0;
    const paidQty = l.qty - free;
    return { itemId: l.itemId, name: l.name, sugar: l.sugar, qty: l.qty, lineTotal: l.price * paidQty, ...(free > 0 ? { redeemed: true, freeQty: free } : {}) };
  });
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);

  // A stale QR would show a stamped-in amount that no longer matches the
  // cart — safer to drop it the moment anything changes than to risk
  // staff showing a QR for the wrong total.
  if (qrDataUrl && total !== qrDataUrl.forTotal) setQrDataUrl(null);

  const showPaynowQr = async () => {
    if (total <= 0) { showToast('Add at least one item'); return; }
    setBusyQr(true);
    const payload = buildPayNowPayload({ amount: total, reference: 'W' + Date.now() });
    try {
      const url = await QRCode.toDataURL(payload, { margin: 1, width: 220 });
      setQrDataUrl({ url, forTotal: total });
    } catch {
      showToast('Could not generate QR code');
    }
    setBusyQr(false);
  };

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
      <div className="sheet-sub">Logged as Received - mark it collected once handed over to award the stamp.</div>

      <div className="field"><label htmlFor="walkin-name">Customer name (optional)</label><input id="walkin-name" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="walkin-phone">Phone (optional - needed for a stamp)</label><input id="walkin-phone" value={phone} onChange={e => { setPhone(e.target.value); setRawFreeQtyByKey({}); }} inputMode="tel" /></div>
      {canRedeem && (
        <div className="section-note" style={{ marginTop: -8, marginBottom: 12, color: 'var(--green-dark)', fontWeight: 800 }}>
          🎁 {customerStamps} stamps + {cartQtyTotal} in this order → {totalFreeUnits} free drink{totalFreeUnits > 1 ? 's' : ''}. Tap 🎁 on a line below ({freeRemaining} left to assign).
        </div>
      )}

      <input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search menu…" />
      {q && categoryEntries.length === 0 && <div className="empty-state">No items match "{query}".</div>}

      {categoryEntries.map(({ cat, items }) => (
        <div key={cat}>
          <div className="section-label" style={{ fontSize: 16, margin: '14px 0 4px 0' }}>{cat}</div>
          {items.map(item => {
            const cap = remaining(item);
            const totalQty = qtyForItem(item.id);
            const soldOutHere = item.soldout || cap === 0;
            const atCap = cap != null && totalQty >= cap;
            return (
              <div className="admin-item-row" key={item.id}>
                <div className="admin-item-top">
                  <div>
                    <div className="admin-item-name" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {item.name}
                      {totalQty > 0 && (
                        <span style={{ background: 'var(--green)', color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                          {totalQty} in order
                        </span>
                      )}
                    </div>
                    <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>
                      {money(item.price)} {soldOutHere ? '· sold out' : (cap != null ? `· ${cap - totalQty} left` : '')}
                    </div>
                  </div>
                  <button className="btn-secondary btn-compact" disabled={soldOutHere || atCap} onClick={() => addUnit(item, currentSugar(item))}>+ Add</button>
                </div>
                {sugarLevelsFor(item).length > 0 && (
                  <div className="opt-row" style={{ marginTop: 10 }}>
                    {sugarLevelsFor(item).map(level => (
                      <button key={level} className={`opt-chip ${currentSugar(item) === level ? 'selected' : ''}`} onClick={() => setPendingSugar(prev => ({ ...prev, [item.id]: level }))}>{level}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {lineEntries.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 16 }}>Order so far</div>
          {lineEntries.map(([key, l]) => {
            const free = freeQtyByKey[key] || 0;
            return (
              <div className="cart-line" key={key}>
                <div className="cart-line-top"><span>{l.name} · {l.sugar}</span><span>{money(l.price * (l.qty - free))}</span></div>
                <div className="cart-line-bottom">
                  <div className="mini-qty">
                    <button className="mini-btn" onClick={() => removeUnit(key)}>−</button>
                    <span>{l.qty}</span>
                    <button className="mini-btn" onClick={() => addUnit(itemById[l.itemId], l.sugar)}>+</button>
                  </div>
                  {canRedeem && (free > 0 || freeRemaining > 0) && (
                    <span className="edit-link" onClick={() => cycleFree(key, l.qty)}>{free > 0 ? `🎁 ${free} free ✓` : '🎁 make free'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="field" style={{ marginTop: 16 }}><label htmlFor="walkin-notes">Notes (optional)</label><textarea id="walkin-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>

      {/* Sticky rather than sitting after the item list — with a full menu
          above it, staff would otherwise have to scroll past every drink
          to reach Total/Log order on every single walk-in. Negative
          margins cancel .sheet's own padding so this spans full width and
          sits flush with the sheet's bottom edge while staying "inside"
          its rounded corners. */}
      <div style={{
        position: 'sticky', bottom: -30, marginLeft: -20, marginRight: -20, marginBottom: -30,
        background: 'var(--cream2)', padding: '14px 20px 30px 20px', boxShadow: '0 -6px 14px -10px rgba(0,0,0,0.25)',
      }}>
        <div className="summary-row total" style={{ marginBottom: 12 }}><span>Total</span><span>{money(total)}</span></div>
        {qrDataUrl ? (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <img src={qrDataUrl.url} alt="PayNow QR code" width={220} height={220} style={{ borderRadius: 12, background: '#fff' }} />
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brand)', marginTop: 6 }}>Scan to pay {money(total)} via PayNow</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setQrDataUrl(null)}>Hide QR</span>
          </div>
        ) : (
          <button className="btn-secondary" disabled={busyQr || lines.length === 0} onClick={showPaynowQr} style={{ marginBottom: 12, width: '100%' }}>
            {busyQr ? 'Generating…' : 'Show PayNow QR'}
          </button>
        )}
        <button className="btn-primary" disabled={busy || lines.length === 0} onClick={submit}><span>{busy ? 'Logging…' : 'Log order'}</span><span>{money(total)}</span></button>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brand)', cursor: 'pointer' }} onClick={onClose}>Cancel</span>
        </div>
      </div>
    </>
  );
}
