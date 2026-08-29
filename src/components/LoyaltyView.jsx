import React from 'react';
import { useMoocha, STAMP_GOAL } from '../store.jsx';
import { money } from '../lib/storage.js';

export default function LoyaltyView() {
  const { myProfile, myStamps, orders } = useMoocha();
  const myPhone = myProfile ? myProfile.phone : null;
  const myOrders = myPhone ? orders.filter(o => o.phone === myPhone) : [];
  const totalStamps = myStamps || 0;
  const stamps = totalStamps > 0 && totalStamps % STAMP_GOAL === 0 ? STAMP_GOAL : totalStamps % STAMP_GOAL;
  const readyForReward = totalStamps > 0 && totalStamps % STAMP_GOAL === 0;
  const title = myProfile ? myProfile.name : 'Your stamp card';
  const subtitle = totalStamps > 0 ? `${stamps} of ${STAMP_GOAL} stamps` : 'Place an order to start collecting!';

  return (
    <>
      <div className="section-label">Your stamp card 🌿</div>
      <div className="section-note">1 stamp per order · {STAMP_GOAL} stamps = a free drink</div>
      <div className="stamp-card">
        <img className="stamp-card-logo" src="/assets/logo-cow.png" alt="" />
        <div className="stamp-deco" style={{ top: 10, left: -6, transform: 'rotate(-14deg)' }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <path d="M17 30C10 25 6 19 6 14a11 11 0 0 1 22 0c0 5-4 11-11 16z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M11 8c2-3 4-4 6-4s4 1 6 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="12.5" cy="15" r="1" fill="currentColor" /><circle cx="21.5" cy="15" r="1" fill="currentColor" />
            <circle cx="17" cy="20" r="1" fill="currentColor" /><circle cx="13.5" cy="21.5" r="1" fill="currentColor" /><circle cx="20.5" cy="21.5" r="1" fill="currentColor" />
          </svg>
        </div>
        <div className="stamp-deco" style={{ bottom: 8, right: 64, transform: 'rotate(10deg)' }}>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M9 7h12l2 4v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11l2-4z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><path d="M9 7l6 4 6-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="stamp-deco" style={{ bottom: -6, left: '50%', transform: 'rotate(-6deg)' }}>
          <svg width="28" height="28" viewBox="0 0 30 30" fill="none"><path d="M15 3c6 4.5 9 10 9 14.5C24 22.5 20 26 15 26s-9-3.5-9-8.5C6 13 9 7.5 15 3z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
        </div>
        <div className="stamp-card-inner">
          <div className="stamp-card-title">{title}</div>
          <div className="stamp-card-goal">{subtitle}</div>
          <div className="stamp-grid">
            {Array.from({ length: STAMP_GOAL }, (_, i) => (
              <div key={i} className={`stamp-slot ${i < stamps ? 'filled' : ''}`}>
                {i < stamps && <img src="/assets/logo-cow.png" alt="stamp" />}
              </div>
            ))}
          </div>
          {readyForReward && <div className="reward-banner">🎉 free drink unlocked — mention it at pickup!</div>}
        </div>
      </div>
      <div className="section-label" style={{ marginTop: 24 }}>Your orders</div>
      {myOrders.length ? myOrders.map(o => (
        <div className="order-row" key={o.id}>
          <div className="order-row-left">
            <div className="oid">#{o.id}</div>
            <div className="oitems">{o.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>
            <span className="order-status">{o.status}</span>
          </div>
          <div className="order-row-right"><div className="oprice">{money(o.total)}</div></div>
        </div>
      )) : <div className="empty-state" style={{ padding: '20px 10px' }}>No orders yet — your first one starts your card 🐮</div>}
    </>
  );
}
