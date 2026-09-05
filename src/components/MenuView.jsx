import { useMoocha } from '../store.jsx';
import ItemThumb from './ItemThumb.jsx';
import { money } from '../lib/storage.js';
import { formatCollectionWindow } from '../lib/pickup.js';

export default function MenuView({ onOpenItem }) {
  const { menu, activeCat, settings, ordersOpen } = useMoocha();
  const items = (menu.categories[activeCat] || []).filter(item => !item.isHidden);

  const preorderRemaining = (item) => item.preorderLimit == null ? null : Math.max(0, item.preorderLimit - (item.preorderSold || 0));
  const isPreorderSoldOut = (item) => preorderRemaining(item) === 0;

  const closedNotice = !ordersOpen && (
    <div className="closed-banner" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <div className="heading" style={{ fontSize: 15 }}>taking a little break 💚</div>
      <div className="sub">browse away — we'll open up checkout again soon!</div>
    </div>
  );

  const collectionWindow = formatCollectionWindow(settings.collectionStart, settings.collectionEnd);
  const collectionNotice = collectionWindow && (
    <div className="closed-banner" style={{ padding: '14px 16px', marginBottom: 14, background: 'var(--mint)' }}>
      <div className="heading" style={{ fontSize: 15, color: 'var(--green-dark)' }}>🕐 pickup window:</div>
      <div className="sub" style={{ color: 'var(--green-dark)' }}>orders placed now are ready for collection {collectionWindow}</div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {closedNotice}
        {collectionNotice}
        <div className="coming-soon"><div className="heading">nothing here yet 🍃</div>more treats coming soon — check back!</div>
      </>
    );
  }

  return (
    <>
      {closedNotice}
      {collectionNotice}
      <div className="menu-list">
        {items.map(item => {
          const preorderSoldOut = isPreorderSoldOut(item);
          const unavailable = item.soldout || preorderSoldOut;
          const statusLabel = item.soldout ? 'sold out today'
            : preorderSoldOut ? 'preorder sold out' : null;
          return (
            <div
              key={item.id}
              className={`item-row ${unavailable ? 'soldout' : ''}`}
              onClick={() => !unavailable && onOpenItem(item.id)}
            >
              <div className="item-row-thumb"><ItemThumb item={item} /></div>
              <div className="item-row-info">
                <div className="item-row-name">{item.name}</div>
                {item.desc && <div className="item-row-desc">{item.desc}</div>}
                <div className="item-row-bottom">
                  <div className="item-price">{money(item.price)}</div>
                  {statusLabel && <div className="soldout-tag">{statusLabel}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
