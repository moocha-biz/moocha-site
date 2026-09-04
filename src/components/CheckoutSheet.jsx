import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function CheckoutSheet({ onClose }) {
  const { sb, myProfile, saveProfile, cart, cartSubtotal, showToast } = useMoocha();
  const [name, setName] = useState(myProfile?.name || '');
  const [phone, setPhone] = useState(myProfile?.phone || '');
  const [email, setEmail] = useState(myProfile?.email || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Generated once per sheet open (not per click) so a double-tap of "Pay
  // with PayNow" reuses the same orderId — that's what lets the edge
  // function's idempotency key actually catch the double-submit.
  const [orderId] = useState(() => 'M' + Date.now().toString().slice(-6));

  const startPayNowCheckout = async () => {
    if (!name.trim() || !phone.trim()) { showToast('Fill in your name and phone number 🙏'); return; }
    if (!sb) { showToast("PayNow isn't set up yet — see README.md"); return; }
    setBusy(true);
    const profile = { name: name.trim(), phone: phone.trim(), email: email.trim() };
    saveProfile(profile);

    // Price/name are re-derived server-side from the items table — only
    // itemId, sugar, and qty actually matter here, the rest is display-only.
    const items = cart.map(l => ({ itemId: l.itemId, sugar: l.sugar, qty: l.qty }));
    // Always redirect back to the root, not wherever checkout happened to
    // be opened from (usually /cart) — App.jsx's stripe redirect handler
    // navigates to the right tab itself once it processes the result.
    const base = window.location.origin;

    showToast('Taking you to PayNow…');
    try {
      const { data, error } = await sb.functions.invoke('create-checkout-session', {
        body: {
          orderId, name: profile.name, phone: profile.phone, email: profile.email, notes: notes.trim(), items,
          // {CHECKOUT_SESSION_ID} is a literal Stripe placeholder — Stripe
          // substitutes it with the real (high-entropy, unguessable)
          // session id on redirect. That's what get_order_receipt looks
          // orders up by now, instead of the guessable, 6-digit orderId.
          successUrl: `${base}?stripe_success=1&order_id=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}?stripe_canceled=1`,
        },
      });
      if (error || !data?.url) {
        console.error(error);
        // data?.error carries a specific reason when the server actually
        // rejected the request (e.g. a stock-limit message) — only fall
        // back to a generic network-ish message when there isn't one, so
        // this never falsely claims PayNow "isn't set up" for what's
        // really a dropped connection or a one-off server hiccup.
        showToast(data?.error || "Couldn't start checkout — check your connection and try again");
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      showToast("Couldn't reach checkout — check your connection and try again");
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
      <div className="field"><label>Email (optional, for receipt)</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" /></div>
      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. allergies, pickup time" /></div>
      <div className="summary-row total" style={{ marginBottom: 14 }}><span>Total</span><span>{money(cartSubtotal)}</span></div>
      <button className="btn-primary" disabled={busy || !sb} onClick={startPayNowCheckout}><span>Pay with PayNow</span><span>{money(cartSubtotal)}</span></button>
    </>
  );
}
