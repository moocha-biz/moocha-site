import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Overlay from '../Overlay.jsx';
import ItemEditorSheet from './ItemEditorSheet.jsx';

export default function MenuEditorTab() {
  const { menu, menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuToggleHidden, menuDeleteItem, showToast } = useMoocha();
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
    if (!window.confirm(`Delete "${cat}" and all its items?`)) return;
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

  const categoryEntries = Object.keys(menu.categories).map(cat => ({
    cat,
    items: q ? menu.categories[cat].filter(item => item.name.toLowerCase().includes(q)) : menu.categories[cat],
  }));
  const anyMatches = categoryEntries.some(({ items }) => items.length > 0);

  return (
    <>
      <button className="btn-secondary" onClick={addCategory}>+ Add category</button>
      <input className="search-input" style={{ marginTop: 10 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search menu items…" />
      {q && !anyMatches && <div className="empty-state">No items match "{query}".</div>}
      {categoryEntries.map(({ cat, items }) => {
        if (q && items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{cat}</span>{!q && <button className="icon-btn danger" title="Delete category" onClick={() => deleteCategory(cat)}>✕</button>}
            </div>
            {items.map((item) => (
              <div className="admin-item-row" key={item.id}>
                <div className="admin-item-top">
                  <div>
                    <div className="admin-item-name">{item.name}</div>
                    <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>{money(item.price)} {item.soldout ? '· sold out' : ''} {item.isHidden ? '· hidden' : ''}</div>
                  </div>
                  <div className="admin-item-actions">
                    <button className="icon-btn" title="Edit item" onClick={() => setEditing({ cat, item })}>✎</button>
                    <button className="icon-btn" title={item.soldout ? 'Mark available' : 'Mark sold out'} onClick={() => toggleSoldout(cat, item.id)}>{item.soldout ? '↺' : '⊘'}</button>
                    <button className="icon-btn" title={item.isHidden ? 'Show on menu' : 'Hide from menu'} onClick={() => toggleHidden(cat, item.id)}>{item.isHidden ? '👁' : '🙈'}</button>
                    <button className="icon-btn danger" title="Delete item" onClick={() => deleteItem(cat, item.id)}>✕</button>
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
