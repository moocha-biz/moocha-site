// A short two-tone chime for "a customer just asked staff to start on
// their order" — synthesized via the Web Audio API instead of an embedded
// audio file, so there's no asset to ship/load. Fails silently: a missing/
// blocked AudioContext (unsupported browser, autoplay policy before any
// user interaction) should never break the page or throw into the
// Realtime subscription callback that calls this.
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq, startAt, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    };
    const now = ctx.currentTime;
    playTone(880, now, 0.18);
    playTone(1174.66, now + 0.14, 0.22);
    // AudioContext isn't needed once the tones finish — close it instead
    // of leaving it (and the browser's per-context resource budget) open.
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // Never let a chime failure break the caller.
  }
}
