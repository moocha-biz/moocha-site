import { useEffect, useState } from 'react';
import { useMoocha, STAMP_GOAL } from '../store.jsx';
import { money } from '../lib/storage.js';
import StampCard from './StampCard.jsx';

export default function LoyaltyView() {
  const { myProfile, myStamps, fetchMyOrders } = useMoocha();
  const myPhone = myProfile ? myProfile.phone : null;
  const myToken = myProfile ? myProfile.customerToken : null;
  const totalStamps = myStamps || 0;
  const [myOrders, setMyOrders] = useState([]);
  // Starts true (not false) so a customer with real order history doesn't
  // see a flash of "No orders yet" every time this tab mounts, for the
  // beat before fetchMyOrders actually resolves.
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!myPhone) { setMyOrders([]); setOrdersLoading(false); return; }
    setOrdersLoading(true);
    fetchMyOrders(myPhone, myToken).then(list => {
      if (cancelled) return;
      setMyOrders(list);
      setOrdersLoading(false);
    });
    return () => { cancelled = true; };
  }, [myPhone, myToken, fetchMyOrders]);

  return (
    <>
      <div className="section-label">Your stamp card 🌿</div>
      <div className="section-note">1 stamp per order · {STAMP_GOAL} stamps = a free drink · tap the card to flip it</div>
      <StampCard stamps={totalStamps} flipEnabled rewardMessage="🎉 free drink unlocked — mention it at pickup!" />
      <div className="section-label" style={{ marginTop: 24 }}>Your orders</div>
      {ordersLoading ? (
        <div className="empty-state" style={{ padding: '20px 10px' }}>Loading your orders…</div>
      ) : myOrders.length ? myOrders.map(o => (
        <div className="order-row" key={o.id}>
          <div className="order-row-left">
            <div className="oid">#{o.id}</div>
            <div className="oitems">{o.items.map(i => `${i.name}${i.sugar ? ` (${i.sugar})` : ''} x${i.qty}`).join(', ')}</div>
            <span className={`order-status ${o.status === 'Refunded' ? 'status-refunded' : o.status === 'Payment failed' ? 'status-failed' : ''}`}>{o.status}</span>
          </div>
          <div className="order-row-right"><div className="oprice">{money(o.total)}</div></div>
        </div>
      )) : <div className="empty-state" style={{ padding: '20px 10px' }}>No orders yet — your first one starts your card 🐮</div>}
    </>
  );
}
