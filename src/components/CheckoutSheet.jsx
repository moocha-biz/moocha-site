import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function CheckoutSheet({ onClose }) {
  const { sb, myProfile, saveProfile, cart, cartSubtotal, showToast, settings } = useMoocha();
  const [name, setName] = useState(myProfile?.name || '');
  const [phone, setPhone] = useState(myProfile?.phone || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const startPayNowCheckout = async () => {
    if (!name.trim() || !phone.trim()) { showToast('Fill in your name and phone number 🙏'); return; }
    if (!sb) { showToast("PayNow isn't set up yet — see README.md"); return; }
    setBusy(true);
    const profile = { name: name.trim(), phone: phone.trim() };
    saveProfile(profile);

    const amount = cartSubtotal;
    const orderId = 'M' + Date.now().toString().slice(-6);
    const items = cart.map(l => ({ name: l.name, qty: l.qty, lineTotal: l.lineTotal }));
    const base = window.location.origin + window.location.pathname;

    showToast('Taking you to PayNow…');
    try {
      const { data, error } = await sb.functions.invoke('create-checkout-session', {
        body: {
          orderId, name: profile.name, phone: profile.phone, notes: notes.trim(), items, amount,
          stallName: settings.stallName,
          successUrl: `${base}?stripe_success=1&order_id=${orderId}`,
          cancelUrl: `${base}?stripe_canceled=1`,
        },
      });
      if (error || !data?.url) { console.error(error); showToast("PayNow isn't set up yet — try again later"); setBusy(false); return; }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      showToast("PayNow isn't set up yet — try again later");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">Checkout 🧋</div>
      <div className="sheet-sub">We'll use this for your order and your stamp card.</div>
      {!sb && <div className="demo-banner" style={{ marginBottom: 14 }}>Connect Supabase and Stripe first (see README.md) for PayNow payment to work.</div>}
      <div className="field"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>
      <div className="field"><label>Phone number</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9XXX XXXX" inputMode="tel" /></div>
      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. allergies, pickup time" /></div>
      <div className="summary-row total" style={{ marginBottom: 14 }}><span>Total</span><span>{money(cartSubtotal)}</span></div>
      <button className="btn-primary" disabled={busy || !sb} onClick={startPayNowCheckout}><span>Pay with PayNow</span><span>{money(cartSubtotal)}</span></button>
    </>
  );
}
