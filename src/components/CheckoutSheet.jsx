import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function CheckoutSheet({ onClose, onPlaced }) {
  const { sb, myProfile, saveProfile, cart, cartSubtotal, insertOrder, bumpCustomerStamp, clearCart, refreshMyLoyalty, showToast, settings, setTab } = useMoocha();
  const [name, setName] = useState(myProfile?.name || '');
  const [phone, setPhone] = useState(myProfile?.phone || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmManualOrder = async () => {
    if (!name.trim() || !phone.trim()) { showToast('Fill in your name and phone number 🙏'); return; }
    setBusy(true);
    const profile = { name: name.trim(), phone: phone.trim() };
    saveProfile(profile);

    const order = {
      id: 'M' + Date.now().toString().slice(-6),
      name: profile.name, phone: profile.phone, date: new Date().toISOString(),
      items: cart.map(l => ({ name: l.name, qty: l.qty, lineTotal: l.lineTotal })),
      total: cartSubtotal, notes: notes.trim(), status: 'Received',
    };
    await insertOrder(order);
    await bumpCustomerStamp(profile.phone, profile.name);
    clearCart();
    onClose();
    await refreshMyLoyalty(profile);
    setTab('loyalty');
    onPlaced?.();
    showToast('Order placed — see you soon! 🎉');
    setBusy(false);
  };

  const startStripeCheckout = async () => {
    if (!name.trim() || !phone.trim()) { showToast('Fill in your name and phone number 🙏'); return; }
    if (!sb) { showToast("Card payment isn't set up yet — use Place order instead"); return; }
    const profile = { name: name.trim(), phone: phone.trim() };
    saveProfile(profile);

    const amount = cartSubtotal;
    const orderId = 'M' + Date.now().toString().slice(-6);
    const items = cart.map(l => ({ name: l.name, qty: l.qty, lineTotal: l.lineTotal }));
    const base = window.location.origin + window.location.pathname;

    showToast('Taking you to payment…');
    try {
      const { data, error } = await sb.functions.invoke('create-checkout-session', {
        body: {
          orderId, name: profile.name, phone: profile.phone, notes: notes.trim(), items, amount,
          stallName: settings.stallName,
          successUrl: `${base}?stripe_success=1&order_id=${orderId}`,
          cancelUrl: `${base}?stripe_canceled=1`,
        },
      });
      if (error || !data?.url) { console.error(error); showToast("Card payment isn't set up yet — use Place order instead"); return; }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      showToast("Card payment isn't set up yet — use Place order instead");
    }
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">Checkout 🧋</div>
      <div className="sheet-sub">We'll use this for your order and your stamp card.</div>
      {!sb && <div className="demo-banner" style={{ marginBottom: 14 }}>Connect Supabase first (see README.md) for this to save for real.</div>}
      <div className="field"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>
      <div className="field"><label>Phone number</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9XXX XXXX" inputMode="tel" /></div>
      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. allergies, pickup time" /></div>
      <div className="summary-row total" style={{ marginBottom: 14 }}><span>Total</span><span>{money(cartSubtotal)}</span></div>
      <button className="btn-primary" disabled={busy} onClick={confirmManualOrder}><span>Place order</span><span>{money(cartSubtotal)}</span></button>
      <div className="section-note" style={{ textAlign: 'center', marginTop: 10 }}>
        Pay {settings.stallName} via PayNow to {settings.stallPhone}, then tap above once you've paid.
      </div>
      {sb && <div className="remove-link" style={{ textAlign: 'center', marginTop: 14 }} onClick={startStripeCheckout}>Pay by card instead</div>}
    </>
  );
}
