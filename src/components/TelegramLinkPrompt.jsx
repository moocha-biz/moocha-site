import { useEffect, useRef, useState } from 'react';
import { useMoocha } from '../store.jsx';
import ActionCard from './ActionCard.jsx';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~1 minute

// Shared by CheckoutSheet, PaymentResultModal, and OrdersView so the
// generate/deep-link/poll logic for linking Telegram isn't duplicated
// between them. `phone` should already be normalized (see CheckoutSheet)
// — orders/stamps are keyed by the normalized phone, so linking against a
// raw, un-normalized value would tie the Telegram link to a phone that
// never matches a real order.
//
// `onStatus`, if given, is called with the current {linked, username} (or
// null while unknown) every time it changes — lets a caller like
// OrdersView gate its own UI (e.g. "Start preparing" requires Telegram) on
// the same linked state this component already tracks, without
// duplicating the fetch/poll logic.
export default function TelegramLinkPrompt({ phone, token, onStatus }) {
  const { requestTelegramLink, fetchTelegramLinkStatus, showToast } = useMoocha();
  const [status, setStatus] = useState(null); // { linked, username } | null while loading
  const [linkUrl, setLinkUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [expired, setExpired] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => { onStatus?.(status); }, [status, onStatus]);

  useEffect(() => {
    clearInterval(pollRef.current);
    setLinkUrl(null);
    setExpired(false);
    if (!BOT_USERNAME || !phone) { setStatus(null); return; }
    let cancelled = false;
    fetchTelegramLinkStatus(phone, token).then(s => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, [phone, token, fetchTelegramLinkStatus]);

  if (!BOT_USERNAME || !phone) return null;

  const connect = async () => {
    setGenerating(true);
    setExpired(false);
    const { code, error } = await requestTelegramLink(phone, token);
    setGenerating(false);
    if (error) { showToast(error); return; }
    setLinkUrl(`https://t.me/${BOT_USERNAME}?start=${code}`);

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      const s = await fetchTelegramLinkStatus(phone, token);
      if (s.linked) {
        clearInterval(pollRef.current);
        setStatus(s);
        setLinkUrl(null);
      } else if (attempts >= POLL_MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setLinkUrl(null);
        setExpired(true);
      }
    }, POLL_INTERVAL_MS);
  };

  if (status?.linked) {
    return (
      <ActionCard tone="mint" title={`Telegram connected${status.username ? ` (@${status.username})` : ''}`} />
    );
  }

  return (
    <ActionCard
      tone="telegram"
      title="Get notified on Telegram"
      description={!linkUrl ? "Enable Telegram connection to moocha bot to tell us when to prepare your order and receive notifications when your order is ready!" : undefined}
    >
      {expired && (
        <div className="sub" style={{ marginBottom: 10 }}>
          Link expired without connecting. Try again?
        </div>
      )}
      {!linkUrl ? (
        <button type="button" className="btn-telegram" disabled={generating} onClick={connect}>
          {generating ? 'Generating…' : expired ? 'Connect again' : 'Connect Telegram'}
        </button>
      ) : (
        <>
          <a className="btn-telegram" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }} href={linkUrl} target="_blank" rel="noreferrer">
            Open Telegram to finish connecting →
          </a>
          <div className="sub" style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
            <span className="pulse-dot" />
            Waiting for you to tap "Start" in Telegram…
          </div>
        </>
      )}
    </ActionCard>
  );
}
