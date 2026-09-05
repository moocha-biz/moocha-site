import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';
import { normalizeSgPhone } from '../lib/phone.js';
import { fireConfetti } from './Confetti.jsx';

export default function CheckoutSheet({ onClose }) {
  const {
    sb, myProfile, saveProfile, cart, showToast,
    redeemedLineId, cartTotalAfterRedeem, clearCart, refreshMyLoyalty, setTab,
  } = useMoocha();
  const [name, setName] = useState(myProfile?.name || '');
  const [phone, setPhone] = useState(myProfile?.phone || '');
  const [email, setEmail] = useState(myProfile?.email || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [redeemedOrder, setRedeemedOrder] = useState(null);
  // Generated once per sheet open (not per click) so a double-tap of "Pay
  // with PayNow" (or "Place order" for a fully-redeemed cart) reuses the
  // same orderId — that's what lets the edge function's idempotency
  // key/conflict handling actually catch the double-submit.
  const [orderId] = useState(() => 'M' + Date.now().toString().slice(-6));

  const isFreeOrder = !!redeemedLineId && cartTotalAfterRedeem === 0;
  // Price/name are re-derived server-side from the items table — only
  // itemId, sugar, qty, and which line is redeemed actually matter here,
  // the rest is display-only. Both edge functions share this exact shape.
  const buildItems = () => cart.map(l => ({
    itemId: l.itemId, sugar: l.sugar, qty: l.qty, ...(l.lineId === redeemedLineId ? { redeemed: true } : {}),
  }));

  const placeFreeOrder = async (profile) => {
    const { data, error } = await sb.functions.invoke('redeem-order', {
      body: {
        orderId, name: profile.name, phone: profile.phone, notes: notes.trim(),
        items: buildItems(), customerToken: myProfile?.customerToken,
      },
    });
    if (error || data?.error || !data?.order) {
      showToast(data?.error || error?.message || "Couldn't place your order — check your connection and try again");
      setBusy(false);
      return;
    }
    clearCart();
    await refreshMyLoyalty();
    fireConfetti();
    setRedeemedOrder(data.order);
    setBusy(false);
  };

  const startPayNowCheckout = async () => {
    if (!name.trim() || !phone.trim()) { showToast('Fill in your name and phone number 🙏'); return; }
    // Catches a typo before it becomes an order that's unrecoverable from
    // My Rewards — an unnormalized/malformed phone here would silently
    // fragment this customer's stamp card into two different records
    // (spaces/dashes aside, get_my_orders/get_my_stamps match phone
    // exactly), not just fail loudly.
    const normalizedPhone = normalizeSgPhone(phone);
    if (!normalizedPhone) { showToast("That doesn't look like a valid mobile number — check and try again"); return; }
    if (!sb) { showToast("PayNow isn't set up yet — see README.md"); return; }
    setBusy(true);
    const profile = { name: name.trim(), phone: normalizedPhone, email: email.trim() };
    saveProfile(profile);

    if (isFreeOrder) {
      await placeFreeOrder(profile);
      return;
    }

    const items = buildItems();
    // Always redirect back to the root, not wherever checkout happened to
    // be opened from (usually /cart) — App.jsx's stripe redirect handler
    // navigates to the right tab itself once it processes the result.
    const base = window.location.origin;

    showToast('Taking you to PayNow…');
    try {
      const { data, error } = await sb.functions.invoke('create-checkout-session', {
        body: {
          orderId, name: profile.name, phone: profile.phone, email: profile.email, notes: notes.trim(), items,
          customerToken: myProfile?.customerToken,
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

  if (redeemedOrder) {
    return (
      <>
        <div className="sheet-close" />
        <div className="sheet-title" style={{ textAlign: 'center' }}>Free drink redeemed! 🎉</div>
        <div className="sheet-sub" style={{ textAlign: 'center' }}>Show this at pickup — no payment needed.</div>
        {(redeemedOrder.items || []).map((it, i) => (
          <div className="summary-row" key={i}><span>{it.name}{it.sugar ? ` (${it.sugar})` : ''} x{it.qty}{it.redeemed ? ' · 🎁 free' : ''}</span><span>{money(it.lineTotal)}</span></div>
        ))}
        <div className="summary-row total"><span>Total</span><span>{money(0)}</span></div>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => { onClose(); setTab('loyalty'); }}><span>See you soon!</span></button>
      </>
    );
  }

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">Checkout 🧋</div>
      <div className="sheet-sub">We'll use this for your order and your stamp card.</div>
      {!sb && <div className="demo-banner" style={{ marginBottom: 14 }}>Connect Supabase and Stripe first (see README.md) for PayNow payment to work.</div>}
      {redeemedLineId && (
        <div className="section-note" style={{ color: 'var(--green-dark)', fontWeight: 800, marginBottom: 4 }}>
          🎁 1 free drink applied from your stamp card
        </div>
      )}
      <div className="field"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>
      <div className="field"><label>Phone number</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="9XXX XXXX" inputMode="tel" /></div>
      {!isFreeOrder && <div className="field"><label>Email (optional, for receipt)</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" /></div>}
      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. allergies, pickup time" /></div>
      <div className="summary-row total" style={{ marginBottom: 14 }}><span>Total</span><span>{money(cartTotalAfterRedeem)}</span></div>
      <button className="btn-primary" disabled={busy || !sb} onClick={startPayNowCheckout}>
        <span>{isFreeOrder ? 'Place order' : 'Pay with PayNow'}</span><span>{money(cartTotalAfterRedeem)}</span>
      </button>
    </>
  );
}
