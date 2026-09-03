import React, { useState } from 'react';
import { useMoocha } from '../store.jsx';
import Header from './Header.jsx';
import CategoryNav from './CategoryNav.jsx';
import MenuView from './MenuView.jsx';
import CartView from './CartView.jsx';
import LoyaltyView from './LoyaltyView.jsx';
import TabBar from './TabBar.jsx';
import Overlay from './Overlay.jsx';
import ItemSheet from './ItemSheet.jsx';
import CheckoutSheet from './CheckoutSheet.jsx';
import PinModal from './PinModal.jsx';

export default function CustomerApp({ onOpenAdmin }) {
  const { tab, setTab, menu, showToast } = useMoocha();
  const [openItemId, setOpenItemId] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const findItem = (id) => {
    for (const cat in menu.categories) {
      const found = menu.categories[cat].find(i => i.id === id);
      if (found) return found;
    }
    return null;
  };
  const openItem = findItem(openItemId);
  const editItem = editLine ? findItem(editLine.itemId) : null;

  const startEditLine = (line) => {
    const found = findItem(line.itemId);
    if (!found) { showToast('This item is no longer on the menu'); return; }
    setEditLine(line);
  };

  return (
    <div className="app-shell">
      <div className="app" id="app">
        <div className="blob" style={{ width: 180, height: 180, background: 'var(--mint)', top: -60, right: -60 }} />
        <div className="blob" style={{ width: 120, height: 120, background: 'var(--blush)', top: 120, left: -50, opacity: 0.35 }} />

        <Header onOpenPin={() => setPinOpen(true)} />

        <nav className="desktop-nav">
          <button className={tab !== 'loyalty' ? 'active' : ''} onClick={() => setTab('menu')}>Menu</button>
          <button className={tab === 'loyalty' ? 'active' : ''} onClick={() => setTab('loyalty')}>Rewards</button>
        </nav>

        <CategoryNav />

        <main id="mainView">
          {tab === 'menu' && <MenuView onOpenItem={setOpenItemId} />}
          {tab === 'cart' && <div className="mobile-only-cart"><CartView onCheckout={() => setCheckoutOpen(true)} onEditLine={startEditLine} /></div>}
          {tab === 'loyalty' && <LoyaltyView />}
        </main>

        <TabBar />
      </div>

      <aside className="cart-sidebar">
        <div className="cart-sidebar-inner">
          <div className="section-label" style={{ marginTop: 0 }}>Your order</div>
          <CartView onCheckout={() => setCheckoutOpen(true)} onEditLine={startEditLine} />
        </div>
      </aside>

      <Overlay show={!!openItem} onClose={() => setOpenItemId(null)} floatClose>
        {openItem && <ItemSheet item={openItem} onClose={() => setOpenItemId(null)} />}
      </Overlay>

      <Overlay show={!!editItem} onClose={() => setEditLine(null)} floatClose>
        {editItem && <ItemSheet item={editItem} editLine={editLine} onClose={() => setEditLine(null)} />}
      </Overlay>

      <Overlay show={checkoutOpen} onClose={() => setCheckoutOpen(false)}>
        <CheckoutSheet onClose={() => setCheckoutOpen(false)} />
      </Overlay>

      <Overlay show={pinOpen} onClose={() => setPinOpen(false)} center cardModal>
        <PinModal onClose={() => setPinOpen(false)} onUnlocked={onOpenAdmin} />
      </Overlay>
    </div>
  );
}
