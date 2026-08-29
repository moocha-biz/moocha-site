import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import { MODIFIERS, DEFAULT_SUGAR_LEVELS } from '../data/defaults.js';
import { money } from '../lib/storage.js';

export default function ItemSheet({ item, editLine, onClose }) {
  const { addLineToCart, updateLine, showToast } = useMoocha();
  const milks = item.milks || [];
  const sugarLevels = (item.sugarLevels && item.sugarLevels.length) ? item.sugarLevels : DEFAULT_SUGAR_LEVELS;
  const toppings = item.toppings || [];

  const [sel, setSel] = useState(() => editLine ? {
    ice: editLine.ice, sugar: editLine.sugar, milk: editLine.milk, size: editLine.size,
    addons: [...editLine.addons], qty: editLine.qty,
  } : {
    ice: item.iced ? 'Normal ice' : null,
    sugar: sugarLevels.includes('50%') ? '50%' : sugarLevels[0],
    milk: milks[0] ? milks[0].name : null,
    size: 'Regular',
    addons: [],
    qty: 1,
  });

  const selectOpt = (key, name) => setSel(prev => ({ ...prev, [key]: name }));
  const toggleAddon = (name) => setSel(prev => {
    const has = prev.addons.includes(name);
    return { ...prev, addons: has ? prev.addons.filter(a => a !== name) : [...prev.addons, name] };
  });
  const changeQty = (d) => setSel(prev => ({ ...prev, qty: Math.max(1, prev.qty + d) }));

  const lineTotal = (() => {
    let unit = item.price;
    const milkOpt = milks.find(o => o.name === sel.milk); if (milkOpt) unit += milkOpt.price;
    const sizeOpt = MODIFIERS.size.options.find(o => o.name === sel.size); if (sizeOpt) unit += sizeOpt.price;
    sel.addons.forEach(name => { const a = toppings.find(x => x.name === name); if (a) unit += a.price; });
    return unit * sel.qty;
  })();

  const addToCart = () => {
    const line = {
      itemId: item.id, name: item.name,
      ice: sel.ice, sugar: sel.sugar, milk: sel.milk, size: sel.size,
      addons: [...sel.addons], qty: sel.qty, lineTotal,
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

  const modRow = (key) => {
    const mod = MODIFIERS[key];
    if (key === 'ice' && !item.iced) return null;
    return (
      <div className="opt-group" key={key}>
        <div className="opt-label">{mod.label} <span className="opt-required">pick one</span></div>
        <div className="opt-row">
          {mod.options.map(o => {
            const name = typeof o === 'string' ? o : o.name;
            const price = typeof o === 'string' ? null : o.price;
            const active = sel[key] === name;
            return (
              <button key={name} className={`opt-chip ${active ? 'selected' : ''}`} onClick={() => selectOpt(key, name)}>
                {name}{price ? ` +${price.toFixed(2)}` : ''}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">{item.name}</div>
      <div className="sheet-sub">{item.desc}</div>
      {modRow('ice')}
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
      {milks.length > 0 && (
        <div className="opt-group">
          <div className="opt-label">Milk <span className="opt-required">pick one</span></div>
          <div className="opt-row">
            {milks.map(o => (
              <button key={o.id} className={`opt-chip ${sel.milk === o.name ? 'selected' : ''}`} onClick={() => selectOpt('milk', o.name)}>
                {o.name}{o.price ? ` +${o.price.toFixed(2)}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      {modRow('size')}
      {toppings.length > 0 && (
        <div className="opt-group">
          <div className="opt-label">Add-ons</div>
          {toppings.map(a => {
            const checked = sel.addons.includes(a.name);
            return (
              <div className="addon-row" key={a.id}>
                <div>
                  <div className="addon-name">{a.name}</div>
                  <div className="addon-price">+{money(a.price)}</div>
                </div>
                <div className={`addon-check ${checked ? 'checked' : ''}`} onClick={() => toggleAddon(a.name)}>{checked ? '✓' : ''}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="qty-row">
        <button className="qty-btn" onClick={() => changeQty(-1)}>−</button>
        <div className="qty-num">{sel.qty}</div>
        <button className="qty-btn" onClick={() => changeQty(1)}>+</button>
      </div>
      <button className="btn-primary" onClick={addToCart}><span>{editLine ? 'Save changes' : 'Add to cart'}</span><span>{money(lineTotal)}</span></button>
    </>
  );
}
