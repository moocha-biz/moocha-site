import { useMoocha } from '../store.jsx';
import ItemThumb from './ItemThumb.jsx';
import ItemTags from './ItemTags.jsx';
import { money } from '../lib/storage.js';

function formatCollectionWindow(start, end) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  const dateFmt = { weekday: 'short', day: 'numeric', month: 'short' };
  const timeFmt = { hour: 'numeric', minute: '2-digit' };
  const sameDay = s.toDateString() === e.toDateString();
  const startStr = `${s.toLocaleDateString(undefined, dateFmt)}, ${s.toLocaleTimeString(undefined, timeFmt)}`;
  const endStr = sameDay ? e.toLocaleTimeString(undefined, timeFmt) : `${e.toLocaleDateString(undefined, dateFmt)}, ${e.toLocaleTimeString(undefined, timeFmt)}`;
  return `${startStr} – ${endStr}`;
}

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
      <div className="heading" style={{ fontSize: 15, color: 'var(--green-dark)' }}>🕐 opening hours:</div>
      <div className="sub" style={{ color: 'var(--green-dark)' }}>{collectionWindow}</div>
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
      <div className="menu-grid">
        {items.map(item => {
          const preorderSoldOut = isPreorderSoldOut(item);
          const unavailable = item.soldout || preorderSoldOut;
          const remaining = preorderRemaining(item);
          const lowStock = !unavailable && remaining != null && remaining < 5;
          return (
            <div
              key={item.id}
              className={`item-card ${unavailable ? 'soldout' : ''}`}
              onClick={() => !unavailable && onOpenItem(item.id)}
            >
              <ItemThumb item={item} />
              <div className="item-info">
                <div className="item-name-row">
                  <div className="item-name">{item.name}</div>
                  <div className="item-name-tags"><ItemTags tags={item.customTags} /></div>
                </div>
                <div className="item-desc">{item.desc}</div>
                <div className="item-price">{money(item.price)}</div>
                {item.soldout && <div className="soldout-tag">sold out today</div>}
                {!item.soldout && preorderSoldOut && <div className="soldout-tag">preorder sold out</div>}
                {lowStock && <div className="low-stock-tag">🔥 only {remaining} left!</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
