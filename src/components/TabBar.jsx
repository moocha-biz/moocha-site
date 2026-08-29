import React from 'react';
import { useMoocha } from '../store.jsx';

export default function TabBar() {
  const { tab, setTab, cart } = useMoocha();
  const count = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="tabbar">
      <button className={`tabitem ${tab === 'menu' ? 'active' : ''}`} onClick={() => setTab('menu')}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        Menu
      </button>
      <button className={`tabitem ${tab === 'loyalty' ? 'active' : ''}`} onClick={() => setTab('loyalty')}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M12 21s-7-4.35-9.5-8.5C.8 8.6 3 5 6.5 5c2 0 3.4 1.1 4 2.2C11.1 6.1 12.5 5 14.5 5 18 5 20.2 8.6 18.5 12.5 16 16.65 12 21 12 21z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
        Rewards
      </button>
      <button className={`tabitem ${tab === 'cart' ? 'active' : ''}`} onClick={() => setTab('cart')} style={{ position: 'relative' }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 8H6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="20" r="1.4" fill="currentColor" /><circle cx="17" cy="20" r="1.4" fill="currentColor" /></svg>
        Cart
        {count > 0 && <span className="cart-badge">{count}</span>}
      </button>
    </div>
  );
}
