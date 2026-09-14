import { useEffect, useRef, useState } from 'react';
import { useMoocha } from '../store.jsx';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~1 minute

// Shared by CheckoutSheet and LoyaltyView so the generate/deep-link/poll
// logic for linking Telegram isn't duplicated between them. `phone` should
// already be normalized (see CheckoutSheet) — orders/stamps are keyed by
// the normalized phone, so linking against a raw, un-normalized value
// would tie the Telegram link to a phone that never matches a real order.
export default function TelegramLinkPrompt({ phone, token }) {
  const { requestTelegramLink, fetchTelegramLinkStatus, showToast } = useMoocha();
  const [status, setStatus] = useState(null); // { linked, username } | null while loading
  const [linkUrl, setLinkUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [expired, setExpired] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

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
      <div className="field">
        <div className="section-note" style={{ color: 'var(--green-dark)', fontWeight: 800 }}>
          ✓ Telegram connected{status.username ? ` (@${status.username})` : ''}
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      {!linkUrl && (
        <div className="section-note" style={{ marginBottom: 6 }}>
          Get a Telegram DM the moment your order's ready for pickup — no need to keep checking back.
        </div>
      )}
      {expired && (
        <div className="sub" style={{ color: 'var(--brand)', marginBottom: 8 }}>
          Link expired without connecting. Try again?
        </div>
      )}
      {!linkUrl ? (
        <button type="button" className="btn-secondary" style={{ marginBottom: 0 }} disabled={generating} onClick={connect}>
          {generating ? 'Generating…' : expired ? '🔔 Connect Telegram again' : '🔔 Connect Telegram'}
        </button>
      ) : (
        <>
          <a className="btn-secondary" style={{ marginBottom: 0, display: 'block', textAlign: 'center', textDecoration: 'none' }} href={linkUrl} target="_blank" rel="noreferrer">
            Open Telegram to finish connecting →
          </a>
          <div className="sub" style={{ color: 'var(--brand)', marginTop: 8, display: 'flex', alignItems: 'center' }}>
            <span className="pulse-dot" />
            Waiting for you to tap "Start" in Telegram…
          </div>
        </>
      )}
    </div>
  );
}
