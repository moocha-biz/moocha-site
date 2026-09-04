import React, { useEffect, useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

// The order row is written by the stripe-webhook function, which can lag a
// beat behind the browser's redirect back from Stripe — so we poll briefly
// instead of assuming it's there immediately.
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1200;

export default function PaymentResultModal({ result, onClose, onRetry }) {
  const { sb, saveCustomerToken } = useMoocha();
  const [order, setOrder] = useState(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    setOrder(null);
    setGaveUp(false);
    // Keyed on Stripe's own session id (high-entropy, only known to this
    // browser via Stripe's redirect), not the human-readable orderId —
    // that id is just a 6-digit timestamp suffix and would let anyone
    // enumerate other customers' receipts.
    if (result?.type !== 'success' || !sb || !result.sessionId) return;
    let cancelled = false;

    const poll = async (attempt) => {
      const { data } = await sb.rpc('get_order_receipt', { p_session_id: result.sessionId });
      if (cancelled) return;
      if (data && data.id) {
        setOrder(data);
        // Handed back once, right after a confirmed paid order — this is
        // what lets My Rewards later prove "this phone is actually mine"
        // instead of anyone being able to type in any phone number.
        if (data.customerToken) saveCustomerToken(data.customerToken);
        return;
      }
      if (attempt >= POLL_ATTEMPTS) { setGaveUp(true); return; }
      setTimeout(() => poll(attempt + 1), POLL_INTERVAL_MS);
    };
    poll(1);
    return () => { cancelled = true; };
  }, [result, sb, saveCustomerToken]);

  if (!result) return null;

  if (result.type === 'canceled') {
    return (
      <>
        <div className="sheet-close" />
        <div className="sheet-title" style={{ textAlign: 'center' }}>Checkout canceled</div>
        <div className="sheet-sub" style={{ textAlign: 'center' }}>No payment was made — your cart is still waiting for you.</div>
        <button className="btn-primary" onClick={onRetry}><span>Try again</span><span>→</span></button>
        <button className="btn-secondary" onClick={onClose}>Back to menu</button>
      </>
    );
  }

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title" style={{ textAlign: 'center' }}>Payment received! 🎉</div>
      {!order && !gaveUp && (
        <div className="sheet-sub" style={{ textAlign: 'center' }}>Confirming your order…</div>
      )}
      {!order && gaveUp && (
        <div className="sheet-sub" style={{ textAlign: 'center' }}>
          Payment went through — we're still finalizing your order. Check My Rewards in a moment if it doesn't show up here.
        </div>
      )}
      {order && (
        <>
          <div className="sheet-sub" style={{ textAlign: 'center' }}>Your loyalty stamp will be given when you collect this order.</div>
          {(order.items || []).map((it, i) => (
            <div className="summary-row" key={i}><span>{it.name}{it.sugar ? ` (${it.sugar})` : ''} x{it.qty}</span><span>{money(it.lineTotal)}</span></div>
          ))}
          <div className="summary-row total"><span>Total</span><span>{money(order.total)}</span></div>
        </>
      )}
      <button className="btn-primary" onClick={onClose}><span>See you soon!</span></button>
    </>
  );
}
