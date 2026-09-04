import React from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function CartView({ onCheckout, onEditLine, compact = false }) {
  const { cart, cartQty, removeLine, cartSubtotal, ordersOpen } = useMoocha();

  if (cart.length === 0) {
    return (
      <div className="empty-state">
        <div className="heading">cart's empty!</div>
        add a drink from the menu to get started 🌿
      </div>
    );
  }

  const disabled = !ordersOpen;

  return (
    <>
      {cart.map(l => {
        const opts = l.sugar || '';
        return (
          <div className="cart-line" key={l.lineId}>
            <div className="cart-line-top"><span>{l.name}</span><span>{money(l.lineTotal)}</span></div>
            <div className="cart-line-opts">{opts}</div>
            <div className="cart-line-bottom">
              <div className="mini-qty">
                <button className="mini-btn" onClick={() => cartQty(l.lineId, -1)}>−</button>
                <span>{l.qty}</span>
                <button className="mini-btn" onClick={() => cartQty(l.lineId, 1)}>+</button>
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                {onEditLine && <span className="edit-link" onClick={() => onEditLine(l)}>Edit</span>}
                <span className="remove-link" onClick={() => removeLine(l.lineId)}>Remove</span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 16 }}>
        <div className="summary-row total"><span>Total</span><span>{money(cartSubtotal)}</span></div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} disabled={disabled} onClick={onCheckout}>
        <span>{disabled ? 'Orders paused' : 'Checkout'}</span><span>{money(cartSubtotal)}</span>
      </button>
    </>
  );
}
