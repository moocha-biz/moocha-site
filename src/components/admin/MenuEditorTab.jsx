import { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Overlay from '../Overlay.jsx';
import ItemEditorSheet from './ItemEditorSheet.jsx';

// Plain glyphs (✎, ⊘, ✕) read fine with a hover title on desktop, but nothing
// hints at what they mean on the touchscreens staff actually use at the
// counter — no hover state to reveal a title there. Actual icon shapes
// (especially eye/eye-slash instead of 👁/🙈, and a trash can instead of a
// bare ✕ that could as easily mean "close") carry meaning without a hover.
function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 7l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SoldOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.5 6.7C4 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.8-1.2M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a15.6 15.6 0 0 1-2.8 3.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Surfaces preorder/walk-in stock right in the list — previously only
// visible after opening the item editor — so staff can spot a
// running-low or sold-out item without a click per item.
function StockLine({ item }) {
  const parts = [];
  if (item.preorderLimit != null) {
    const left = Math.max(0, item.preorderLimit - (item.preorderSold || 0));
    parts.push({ label: `Preorder: ${left}/${item.preorderLimit} left`, low: left === 0, warn: left > 0 && left < 5 });
  }
  if (item.walkinLimit != null) {
    const left = Math.max(0, item.walkinLimit - (item.walkinSold || 0));
    parts.push({ label: `Walk-in: ${left}/${item.walkinLimit} left`, low: left === 0, warn: left > 0 && left < 5 });
  }
  if (parts.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {parts.map((p, i) => (
        <span key={i} className={p.low ? 'soldout-tag' : p.warn ? 'low-stock-tag' : ''} style={p.low || p.warn ? undefined : { fontSize: 10.5, fontWeight: 800, color: 'var(--brand)', padding: '3px 10px', borderRadius: 999, background: 'var(--mint)' }}>
          {p.label}
        </span>
      ))}
    </div>
  );
}

export default function MenuEditorTab() {
  const { menu, menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuToggleHidden, menuDeleteItem, menuMoveItem, showToast } = useMoocha();
  const [editing, setEditing] = useState(null); // { cat, item }
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const addCategory = () => {
    const name = window.prompt('New category name:');
    if (!name) return;
    menuAddCategory(name);
    showToast('Category added ✓');
  };
  const deleteCategory = (cat) => {
    const count = (menu.categories[cat] || []).length;
    const itemsPhrase = count > 0 ? `and its ${count} item${count === 1 ? '' : 's'}` : '(it has no items)';
    if (!window.confirm(`Delete "${cat}" ${itemsPhrase}?`)) return;
    menuDeleteCategory(cat);
    showToast('Category deleted ✓');
  };
  const toggleSoldout = (cat, id) => menuToggleSoldout(cat, id);
  const toggleHidden = (cat, id) => menuToggleHidden(cat, id);
  const deleteItem = (cat, id) => {
    if (!window.confirm('Delete this item?')) return;
    menuDeleteItem(cat, id);
    showToast('Item deleted ✓');
  };
  const moveItem = (cat, id, direction) => menuMoveItem(cat, id, direction);

  const categoryEntries = Object.keys(menu.categories).map((cat, idx) => ({
    cat, idx,
    items: q ? menu.categories[cat].filter(item => item.name.toLowerCase().includes(q)) : menu.categories[cat],
  }));
  const anyMatches = categoryEntries.some(({ items }) => items.length > 0);

  // Jumps straight to a category instead of scrolling past everything
  // above it - the more categories there are, the more that matters.
  const jumpToCategory = (idx) => {
    document.getElementById(`admin-cat-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <button className="btn-secondary" onClick={addCategory}>+ Add category</button>
      <input className="search-input" style={{ marginTop: 10 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search menu items…" />
      {/* Search already scrolls the whole list down to matches, so the jump
          nav (which would just point back at the same categories) only adds
          value when browsing the full, unfiltered menu. */}
      {!q && categoryEntries.length > 1 && (
        <nav className="admin-cat-nav">
          {categoryEntries.map(({ cat, idx }) => (
            <button key={cat} className="navbtn" onClick={() => jumpToCategory(idx)}>{cat}</button>
          ))}
        </nav>
      )}
      {q && !anyMatches && <div className="empty-state">No items match "{query}".</div>}
      {categoryEntries.map(({ cat, idx, items }) => {
        if (q && items.length === 0) return null;
        return (
          <div key={cat}>
            <div id={`admin-cat-${idx}`} className="section-label admin-cat-anchor" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{cat}</span>
              {/* Deleting a category takes every item in it with it - a much
                  bigger blast radius than deleting one item, so it stays
                  visually quiet (no permanent red pill) until you're
                  actually about to reach for it. */}
              {!q && <button className="icon-btn danger category-delete" title="Delete category" onClick={() => deleteCategory(cat)}><TrashIcon /></button>}
            </div>
            {items.map((item, i) => (
              <div className="admin-item-row" key={item.id}>
                <div className="admin-item-top">
                  <div>
                    <div className="admin-item-name">{item.name}</div>
                    <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>{money(item.price)} {item.soldout ? '· sold out' : ''} {item.isHidden ? '· hidden' : ''}</div>
                    <StockLine item={item} />
                  </div>
                  <div className="admin-item-actions">
                    {/* Reordering moves the item within its full category,
                        so it only makes sense against the true, unfiltered
                        position — hidden while a search narrows `items` to
                        a subset (same reasoning as the category-delete
                        button above). */}
                    {!q && (
                      <>
                        <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveItem(cat, item.id, 'up')}><ArrowUpIcon /></button>
                        <button className="icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => moveItem(cat, item.id, 'down')}><ArrowDownIcon /></button>
                        <div className="icon-btn-divider" />
                      </>
                    )}
                    <button className="icon-btn" title="Edit item" onClick={() => setEditing({ cat, item })}><PencilIcon /></button>
                    <button className="icon-btn" title={item.soldout ? 'Mark available' : 'Mark sold out'} onClick={() => toggleSoldout(cat, item.id)}>{item.soldout ? <RestoreIcon /> : <SoldOutIcon />}</button>
                    <button className="icon-btn" title={item.isHidden ? 'Show on menu' : 'Hide from menu'} onClick={() => toggleHidden(cat, item.id)}><EyeIcon open={item.isHidden} /></button>
                    <div className="icon-btn-divider" />
                    <button className="icon-btn danger" title="Delete item" onClick={() => deleteItem(cat, item.id)}><TrashIcon /></button>
                  </div>
                </div>
              </div>
            ))}
            <button className="btn-secondary" onClick={() => setEditing({ cat, item: null })}>+ Add item to {cat}</button>
          </div>
        );
      })}
      <Overlay show={!!editing} onClose={() => setEditing(null)}>
        {editing && <ItemEditorSheet cat={editing.cat} item={editing.item} onClose={() => setEditing(null)} />}
      </Overlay>
    </>
  );
}
