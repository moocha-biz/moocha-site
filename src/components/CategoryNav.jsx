import React from 'react';
import { useMoocha } from '../store.jsx';

export default function CategoryNav() {
  const { tab, menu, activeCat, setActiveCat } = useMoocha();
  if (tab !== 'menu') return null;
  return (
    <nav id="catNav">
      {Object.keys(menu.categories).map(cat => (
        <button
          key={cat}
          className={`navbtn ${cat === activeCat ? 'active' : ''}`}
          onClick={() => setActiveCat(cat)}
        >
          {cat}
        </button>
      ))}
    </nav>
  );
}
