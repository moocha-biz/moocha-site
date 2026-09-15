import { useEffect, useState } from 'react';
import { useMoocha } from '../store.jsx';
import { money } from '../lib/storage.js';
import { formatCollectionWindow } from '../lib/pickup.js';
import TelegramLinkPrompt from './TelegramLinkPrompt.jsx';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

// Live-polls the queue position for whichever orders are currently
// 'Preparing' — a page reload (or an order that entered 'Preparing' from
// a staff action or the Telegram bot, never a fetch this browser already
// had) would otherwise never show aheadDrinks at all, since that value
// used to only ever come from a one-off local snapshot.
const QUEUE_POLL_MS = 5000;
function useQueuePolling(orders, setOrders) {
  const { fetchQueuePosition } = useMoocha();
  useEffect(() => {
    const preparingIds = orders.filter(o => o.status === 'Preparing').map(o => o.id);
    if (preparingIds.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const results = await Promise.all(preparingIds.map(id => fetchQueuePosition(id)));
      if (cancelled) return;
      setOrders(list => list.map(o => {
        const i = preparingIds.indexOf(o.id);
        return i === -1 ? o : { ...o, aheadDrinks: results[i].aheadDrinks };
      }));
    };
    poll();
    const timer = setInterval(poll, QUEUE_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [orders.map(o => `${o.id}:${o.status}`).join(','), fetchQueuePosition]);
}

// Order list/status + the Telegram order-notification opt-in — split out
// of LoyaltyView (now just the stamp card) since this is all about an
// order, not the rewards program itself. Own /orders page.
export default function OrdersView() {
  const { myProfile, fetchMyOrders, settings } = useMoocha();
  const myPhone = myProfile ? myProfile.phone : null;
  const myToken = myProfile ? myProfile.customerToken : null;
  const [myOrders, setMyOrders] = useState([]);
  // "Start preparing" is only meaningful while the shop is actually open to
  // collect it — this app's only "opening hours" concept is the preorder
  // collection window (settings.collectionStart/collectionEnd, "Collection
  // hours" in admin Settings). Null bound = no restriction, same as
  // formatCollectionWindow/ordersOpen elsewhere. The server (request_order_prep)
  // enforces this too — this is just so the button doesn't invite a tap
  // that'll get rejected.
  const now = Date.now();
  const collectionOpen =
    (!settings.collectionStart || now >= new Date(settings.collectionStart).getTime()) &&
    (!settings.collectionEnd || now <= new Date(settings.collectionEnd).getTime());
  const collectionWindow = formatCollectionWindow(settings.collectionStart, settings.collectionEnd);
  // {linked, username} | null — fed by TelegramLinkPrompt's onStatus, so
  // "Start preparing" (which requires Telegram, see below) can gate on the
  // exact same linked state the connect prompt itself tracks.
  const [telegramStatus, setTelegramStatus] = useState(null);
  // Starts true (not false) so a customer with real order history doesn't
  // see a flash of "No orders yet" every time this tab mounts, for the
  // beat before fetchMyOrders actually resolves.
  const [ordersLoading, setOrdersLoading] = useState(true);

  const refetchOrders = () => {
    if (!myPhone) return;
    fetchMyOrders(myPhone, myToken).then(setMyOrders);
  };

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

  // "Start preparing" hands off to the Telegram bot (see below) rather
  // than calling an RPC directly from here — the actual status change
  // happens server-side once the customer sends /start over there, on a
  // browser tab we don't control. Refetching on tab-focus is how this tab
  // finds out about it when they switch back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refetchOrders(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [myPhone, myToken]);

  useQueuePolling(myOrders, setMyOrders);

  return (
    <>
      {myPhone && (
        <>
          <div className="section-label">Order notifications</div>
          <TelegramLinkPrompt phone={myPhone} token={myToken} onStatus={setTelegramStatus} />
        </>
      )}
      <div className="section-label" style={{ marginTop: myPhone ? 24 : 0 }}>Your orders</div>
      {ordersLoading ? (
        <div className="empty-state" style={{ padding: '20px 10px' }}>Loading your orders…</div>
      ) : myOrders.length ? myOrders.map(o => (
        <div className="order-row" key={o.id}>
          <div className="order-row-left">
            <div className="oid">#{o.id}</div>
            <div className="oitems">{o.items.map(i => `${i.name}${i.sugar ? ` (${i.sugar})` : ''} x${i.qty}`).join(', ')}</div>
            <span className={`order-status ${o.status === 'Refunded' ? 'status-refunded' : o.status === 'Payment failed' ? 'status-failed' : o.status === 'Preparing' ? 'status-preparing' : ''}`}>{o.status}</span>
          </div>
          <div className="order-row-right">
            <div className="oprice">{money(o.total)}</div>
            {o.status === 'Received' && o.orderType !== 'walkin' && (
              !telegramStatus?.linked ? (
                <div className="order-row-note">Connect Telegram above to start preparing your order</div>
              ) : !collectionOpen ? (
                <div className="order-row-note">
                  {collectionWindow ? `You can ask staff to start on your order during collection hours: ${collectionWindow}.` : "You can ask staff to start on your order once collection hours open"}
                </div>
              ) : (
                <a
                  className="btn-secondary btn-compact"
                  style={{ textDecoration: 'none', marginTop: 0 }}
                  href={`https://t.me/${BOT_USERNAME}?start=prep_${o.id}`}
                  target="_blank" rel="noreferrer"
                >
                  Start preparing my order
                </a>
              )
            )}
            {o.status === 'Preparing' && o.aheadDrinks != null && (
              <div className="order-row-note">
                {o.aheadDrinks === 0 ? "You're next!" : `${o.aheadDrinks} drink${o.aheadDrinks === 1 ? '' : 's'} ahead of you`}
              </div>
            )}
          </div>
        </div>
      )) : <div className="empty-state" style={{ padding: '20px 10px' }}>No orders yet - place one from the menu</div>}
    </>
  );
}
