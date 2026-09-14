import { useEffect, useState } from 'react';
import { useMoocha, STAMP_GOAL } from '../store.jsx';
import { money } from '../lib/storage.js';
import StampCard from './StampCard.jsx';
import TelegramLinkPrompt from './TelegramLinkPrompt.jsx';

export default function LoyaltyView() {
  const { myProfile, myStamps, fetchMyOrders, requestOrderPrep, showToast } = useMoocha();
  const myPhone = myProfile ? myProfile.phone : null;
  const myToken = myProfile ? myProfile.customerToken : null;
  const totalStamps = myStamps || 0;
  const [myOrders, setMyOrders] = useState([]);
  const [requestingId, setRequestingId] = useState(null);
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

  // Lets a customer who preordered ahead of arrival tell staff "start
  // making it now", instead of it sitting there until staff decide on
  // their own or the customer shows up at the counter and asks in person.
  const startPreparing = async (id) => {
    setRequestingId(id);
    const { error, changed, aheadDrinks } = await requestOrderPrep(id, myPhone, myToken);
    setRequestingId(null);
    if (error) { showToast('Could not reach staff - try again in a moment'); return; }
    if (changed) setMyOrders(list => list.map(o => o.id === id ? { ...o, status: 'Preparing', aheadDrinks } : o));
    showToast(changed ? "Staff notified - they'll start on it now ✓" : 'Already being prepared ✓');
  };

  return (
    <>
      <div className="section-label">Your stamp card 🌿</div>
      <div className="section-note">1 stamp per drink · {STAMP_GOAL} stamps = a free drink · tap the card to flip it</div>
      <StampCard stamps={totalStamps} flipEnabled rewardMessage="🎉 free drink unlocked - mention it at pickup!" />
      {myPhone && (
        <>
          <div className="section-label" style={{ marginTop: 24 }}>Order-ready alerts</div>
          <TelegramLinkPrompt phone={myPhone} token={myToken} />
        </>
      )}
      <div className="section-label" style={{ marginTop: 24 }}>Your orders</div>
      {ordersLoading ? (
        <div className="empty-state" style={{ padding: '20px 10px' }}>Loading your orders…</div>
      ) : myOrders.length ? myOrders.map(o => (
        <div className="order-row" key={o.id} style={{ alignItems: 'flex-start' }}>
          <div className="order-row-left">
            <div className="oid">#{o.id}</div>
            <div className="oitems">{o.items.map(i => `${i.name}${i.sugar ? ` (${i.sugar})` : ''} x${i.qty}`).join(', ')}</div>
            <span className={`order-status ${o.status === 'Refunded' ? 'status-refunded' : o.status === 'Payment failed' ? 'status-failed' : o.status === 'Preparing' ? 'status-preparing' : ''}`}>{o.status}</span>
            {o.status === 'Received' && o.orderType !== 'walkin' && (
              <button
                className="btn-secondary btn-compact"
                style={{ display: 'block', marginTop: 8, marginBottom: 0 }}
                disabled={requestingId === o.id}
                onClick={() => startPreparing(o.id)}
              >
                {requestingId === o.id ? 'Letting staff know…' : '▶ Start preparing my order'}
              </button>
            )}
            {o.status === 'Preparing' && o.aheadDrinks != null && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--brand)', marginTop: 6 }}>
                🔥 {o.aheadDrinks === 0 ? "You're next!" : `${o.aheadDrinks} drink${o.aheadDrinks === 1 ? '' : 's'} ahead of you`}
              </div>
            )}
          </div>
          <div className="order-row-right"><div className="oprice">{money(o.total)}</div></div>
        </div>
      )) : <div className="empty-state" style={{ padding: '20px 10px' }}>No orders yet - your first one starts your card 🐮</div>}
    </>
  );
}
