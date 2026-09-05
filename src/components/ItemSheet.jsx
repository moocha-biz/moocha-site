import { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { DEFAULT_SUGAR_LEVELS } from '../data/defaults.js';
import { money } from '../lib/storage.js';
import ItemThumb from './ItemThumb.jsx';
import ItemTags from './ItemTags.jsx';

export default function ItemSheet({ item, editLine, onClose }) {
  const { addLineToCart, updateLine, showToast, ordersOpen, cart } = useMoocha();
  const sugarLevels = (item.sugarLevels && item.sugarLevels.length) ? item.sugarLevels : DEFAULT_SUGAR_LEVELS;
  // Stock is tracked per item, not per sugar level — so this counts every
  // cart line for this item regardless of sugar choice (excluding the line
  // being edited), so re-adding the same drink across separate visits to
  // this sheet can't stack past the stock limit once merged into the cart.
  const alreadyInCart = cart
    .filter(l => l.itemId === item.id && (!editLine || l.lineId !== editLine.lineId))
    .reduce((s, l) => s + l.qty, 0);
  const remaining = item.preorderLimit == null ? null : Math.max(0, item.preorderLimit - (item.preorderSold || 0) - alreadyInCart);
  const disabled = !ordersOpen || remaining === 0;

  const [sel, setSel] = useState(() => editLine ? {
    sugar: editLine.sugar, qty: editLine.qty,
  } : {
    sugar: sugarLevels.includes('50%') ? '50%' : sugarLevels[0],
    qty: 1,
  });

  const selectOpt = (key, name) => setSel(prev => ({ ...prev, [key]: name }));
  const changeQty = (d) => setSel(prev => {
    if (d > 0 && remaining != null && prev.qty + d > remaining) {
      showToast(`Only ${remaining} left for preorder this week`);
      return prev;
    }
    return { ...prev, qty: Math.max(1, prev.qty + d) };
  });

  const lineTotal = item.price * sel.qty;

  const addToCart = () => {
    const line = {
      itemId: item.id, name: item.name,
      sugar: sel.sugar,
      qty: sel.qty, lineTotal,
    };
    if (editLine) {
      updateLine(editLine.lineId, line);
      onClose();
      showToast(`Updated ${item.name} 🍵`);
    } else {
      addLineToCart({ lineId: Date.now() + Math.random(), ...line });
      onClose();
      showToast(`Added ${item.name} 🍵`);
    }
  };

  return (
    <>
      <div className="sheet-item-thumb">
        <ItemThumb item={item} />
      </div>
      <div className="sheet-name-row">
        <div className="sheet-title">{item.name}</div>
        <div className="item-name-tags"><ItemTags tags={item.customTags} /></div>
      </div>
      <div className="sheet-sub">{item.desc}</div>
      {remaining != null && remaining > 0 && remaining < 5 && <div className="low-stock-tag" style={{ marginTop: -8, marginBottom: 10 }}>🔥 only {remaining} left this week — grab yours!</div>}
      {sugarLevels.length > 0 && (
        <div className="opt-group">
          <div className="opt-label">Sweetness <span className="opt-required">pick one</span></div>
          <div className="opt-row">
            {sugarLevels.map(name => (
              <button key={name} className={`opt-chip ${sel.sugar === name ? 'selected' : ''}`} onClick={() => selectOpt('sugar', name)}>{name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="qty-label">Quantity</div>
      <div className="qty-row">
        <button className="qty-btn" onClick={() => changeQty(-1)}>−</button>
        <div className="qty-num">{sel.qty}</div>
        <button className="qty-btn" onClick={() => changeQty(1)}>+</button>
      </div>
      <button className="btn-primary" disabled={disabled} onClick={addToCart}>
        <span>{remaining === 0 ? 'Sold out for preorder' : disabled ? 'Orders paused' : (editLine ? 'Save changes' : 'Add to cart')}</span><span>{money(lineTotal)}</span>
      </button>
    </>
  );
}
