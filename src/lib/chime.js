// A short two-tone chime for "a customer just asked staff to start on
// their order" — synthesized via the Web Audio API instead of an embedded
// audio file, so there's no asset to ship/load. Fails silently: a missing/
// blocked AudioContext (unsupported browser, autoplay policy before any
// user interaction) should never break the page or throw into the
// Realtime subscription callback that calls this.
//
// One shared AudioContext, resumed on the first tap/keypress anywhere on
// the page. Browsers start a context created outside a user gesture in the
// "suspended" state, and the chime is always triggered from a Realtime
// callback (never a gesture) — so creating a fresh context per chime meant
// it often never played at all.
let ctx = null;

function getContext() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

// Called by AdminApp on mount (not at import time — store.jsx imports this
// module for customers too, who should never get an AudioContext). Returns
// a cleanup for the effect.
export function enableChimeUnlock() {
  const unlock = () => {
    try {
      const c = getContext();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    } catch {
      // ignore
    }
    if (ctx?.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

export function playChime() {
  try {
    const c = getContext();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const playTone = (freq, startAt, duration) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    };
    const now = c.currentTime;
    playTone(880, now, 0.18);
    playTone(1174.66, now + 0.14, 0.22);
  } catch {
    // Never let a chime failure break the caller.
  }
}
