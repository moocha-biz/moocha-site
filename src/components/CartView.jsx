import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function CartView({ onCheckout, onEditLine, compact = false }) {
  const {
    cart, cartQty, removeLine, ordersOpen,
    loyaltyRedeemEligible, redeemedLineId, setRedeemedLineId, cartTotalAfterRedeem,
  } = useMoocha();

  if (cart.length === 0) {
    return (
      <div className="empty-state">
        <div className="heading">cart's empty!</div>
        add a drink from the menu to get started 🌿
      </div>
    );
  }

  const disabled = !ordersOpen;
  const toggleRedeem = (lineId) => setRedeemedLineId(prev => prev === lineId ? null : lineId);

  return (
    <>
      {loyaltyRedeemEligible && (
        <div className="section-note" style={{ color: 'var(--green-dark)', fontWeight: 800, marginBottom: 4 }}>
          🎁 You have a free drink ready — tap "make 1 free" on a line below.
        </div>
      )}
      {cart.map(l => {
        const opts = l.sugar || '';
        const isRedeemed = redeemedLineId === l.lineId;
        return (
          <div className="cart-line" key={l.lineId}>
            <div className="cart-line-top"><span>{l.name}</span><span>{money(isRedeemed ? l.lineTotal - (l.lineTotal / l.qty) : l.lineTotal)}</span></div>
            <div className="cart-line-opts">{[opts, isRedeemed ? '🎁 1 free' : ''].filter(Boolean).join(' · ')}</div>
            <div className="cart-line-bottom">
              <div className="mini-qty">
                <button className="mini-btn" onClick={() => cartQty(l.lineId, -1)}>−</button>
                <span>{l.qty}</span>
                <button className="mini-btn" onClick={() => cartQty(l.lineId, 1)}>+</button>
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                {onEditLine && <span className="edit-link" onClick={() => onEditLine(l)}>Edit</span>}
                {loyaltyRedeemEligible && <span className="edit-link" onClick={() => toggleRedeem(l.lineId)}>{isRedeemed ? '1 free ✓' : 'make 1 free'}</span>}
                <span className="remove-link" onClick={() => removeLine(l.lineId)}>Remove</span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 16 }}>
        <div className="summary-row total"><span>Total</span><span>{money(cartTotalAfterRedeem)}</span></div>
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} disabled={disabled} onClick={onCheckout}>
        <span>{disabled ? 'Orders paused' : 'Checkout'}</span><span>{money(cartTotalAfterRedeem)}</span>
      </button>
    </>
  );
}
