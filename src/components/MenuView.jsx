import React from 'react';
import { useMoocha } from '../store.jsx';
import ItemThumb from './ItemThumb.jsx';
import { money } from '../lib/storage.js';

export default function MenuView({ onOpenItem }) {
  const { menu, activeCat, settings } = useMoocha();
  const items = menu.categories[activeCat] || [];

  const closedNotice = !settings.paymentEnabled && (
    <div className="closed-banner" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <div className="heading" style={{ fontSize: 15 }}>taking a little break 💚</div>
      <div className="sub">browse away — we'll open up checkout again soon!</div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {closedNotice}
        <div className="coming-soon"><div className="heading">nothing here yet 🍃</div>more treats coming soon — check back!</div>
      </>
    );
  }

  return (
    <>
      {closedNotice}
      <div className="menu-grid">
        {items.map(item => (
          <div
            key={item.id}
            className={`item-card ${item.soldout ? 'soldout' : ''}`}
            onClick={() => !item.soldout && onOpenItem(item.id)}
          >
            <ItemThumb item={item} />
            <div className="item-info">
              <div className="item-name">{item.name}</div>
              <div className="item-desc">{item.desc}</div>
              <div className="item-price">{money(item.price)}</div>
              {item.soldout && <div className="soldout-tag">sold out today</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
