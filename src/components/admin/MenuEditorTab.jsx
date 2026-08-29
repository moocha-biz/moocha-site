import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';
import { money } from '../../lib/storage.js';
import Overlay from '../Overlay.jsx';
import ItemEditorSheet from './ItemEditorSheet.jsx';

export default function MenuEditorTab() {
  const { menu, menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuDeleteItem, menuMoveItem } = useMoocha();
  const [editing, setEditing] = useState(null); // { cat, item }

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
  const deleteItem = (cat, id) => {
    if (!window.confirm('Delete this item?')) return;
    menuDeleteItem(cat, id);
  };
  const moveItem = (cat, id, dir) => menuMoveItem(cat, id, dir);

  return (
    <>
      <button className="btn-secondary" onClick={addCategory}>+ Add category</button>
      {Object.keys(menu.categories).map(cat => {
        const items = menu.categories[cat];
        return (
          <div key={cat}>
            <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{cat}</span><button className="icon-btn danger" onClick={() => deleteCategory(cat)}>✕</button>
            </div>
            {items.map((item, i) => (
              <div className="admin-item-row" key={item.id}>
                <div className="admin-item-top">
                  <div>
                    <div className="admin-item-name">{item.name}</div>
                    <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>{money(item.price)} {item.soldout ? '· sold out' : ''}</div>
                  </div>
                  <div className="admin-item-actions">
                    <button className="icon-btn" disabled={i === 0} style={i === 0 ? { opacity: 0.35 } : undefined} onClick={() => moveItem(cat, item.id, -1)}>↑</button>
                    <button className="icon-btn" disabled={i === items.length - 1} style={i === items.length - 1 ? { opacity: 0.35 } : undefined} onClick={() => moveItem(cat, item.id, 1)}>↓</button>
                    <button className="icon-btn" onClick={() => setEditing({ cat, item })}>✎</button>
                    <button className="icon-btn" onClick={() => toggleSoldout(cat, item.id)}>{item.soldout ? '↺' : '⊘'}</button>
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
