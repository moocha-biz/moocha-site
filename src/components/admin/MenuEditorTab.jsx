import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Overlay from '../Overlay.jsx';
import ItemEditorSheet from './ItemEditorSheet.jsx';

export default function MenuEditorTab() {
  const { menu, menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuToggleHidden, menuDeleteItem } = useMoocha();
  const [editing, setEditing] = useState(null); // { cat, item }
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const addCategory = () => {
    const name = window.prompt('New category name:');
    if (!name) return;
    menuAddCategory(name);
  };
  const deleteCategory = (cat) => {
    if (!window.confirm(`Delete "${cat}" and all its items?`)) return;
    menuDeleteCategory(cat);
  };
  const toggleSoldout = (cat, id) => menuToggleSoldout(cat, id);
  const toggleHidden = (cat, id) => menuToggleHidden(cat, id);
  const deleteItem = (cat, id) => {
    if (!window.confirm('Delete this item?')) return;
    menuDeleteItem(cat, id);
  };

  const categoryEntries = Object.keys(menu.categories).map(cat => ({
    cat,
    items: q ? menu.categories[cat].filter(item => item.name.toLowerCase().includes(q)) : menu.categories[cat],
  }));
  const anyMatches = categoryEntries.some(({ items }) => items.length > 0);

  return (
    <>
      <button className="btn-secondary" onClick={addCategory}>+ Add category</button>
      <input
        value={query} onChange={e => setQuery(e.target.value)} placeholder="Search menu items…"
        style={{ width: '100%', border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 14, padding: '11px 14px', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)', margin: '10px 0 14px 0' }}
      />
      {q && !anyMatches && <div className="empty-state">No items match "{query}".</div>}
      {categoryEntries.map(({ cat, items }) => {
        if (q && items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{cat}</span>{!q && <button className="icon-btn danger" onClick={() => deleteCategory(cat)}>✕</button>}
            </div>
            {items.map((item) => (
              <div className="admin-item-row" key={item.id}>
                <div className="admin-item-top">
                  <div>
                    <div className="admin-item-name">{item.name}</div>
                    <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>{money(item.price)} {item.soldout ? '· sold out' : ''} {item.isHidden ? '· hidden' : ''}</div>
                  </div>
                  <div className="admin-item-actions">
                    <button className="icon-btn" onClick={() => setEditing({ cat, item })}>✎</button>
                    <button className="icon-btn" onClick={() => toggleSoldout(cat, item.id)}>{item.soldout ? '↺' : '⊘'}</button>
                    <button className="icon-btn" onClick={() => toggleHidden(cat, item.id)}>{item.isHidden ? '👁' : '🙈'}</button>
                    <button className="icon-btn danger" onClick={() => deleteItem(cat, item.id)}>✕</button>
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
