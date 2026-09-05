import { useState } from 'react';
import { STAMP_GOAL } from '../store.jsx';

const SCALLOP_PATH = `M0.03,0.08
  C0.06,0.02 0.10,0.02 0.13,0.06 C0.16,0.02 0.20,0.02 0.23,0.06 C0.26,0.02 0.30,0.02 0.33,0.06
  C0.36,0.02 0.40,0.02 0.43,0.06 C0.46,0.02 0.50,0.02 0.53,0.06 C0.56,0.02 0.60,0.02 0.63,0.06
  C0.66,0.02 0.70,0.02 0.73,0.06 C0.76,0.02 0.80,0.02 0.83,0.06 C0.87,0.02 0.94,0.03 0.97,0.09
  C0.93,0.14 0.94,0.18 0.97,0.22 C0.94,0.27 0.94,0.31 0.97,0.36
  C0.94,0.41 0.94,0.45 0.97,0.50 C0.94,0.55 0.94,0.59 0.97,0.64
  C0.94,0.69 0.94,0.73 0.97,0.78 C0.94,0.83 0.93,0.87 0.97,0.92
  C0.94,0.97 0.87,0.98 0.83,0.94 C0.80,0.98 0.76,0.98 0.73,0.94 C0.70,0.98 0.66,0.98 0.63,0.94
  C0.60,0.98 0.56,0.98 0.53,0.94 C0.50,0.98 0.46,0.98 0.43,0.94 C0.40,0.98 0.36,0.98 0.33,0.94
  C0.30,0.98 0.26,0.98 0.23,0.94 C0.20,0.98 0.16,0.98 0.13,0.94 C0.10,0.98 0.06,0.98 0.03,0.92
  C0.06,0.87 0.06,0.83 0.03,0.78 C0.06,0.73 0.06,0.69 0.03,0.64
  C0.06,0.59 0.06,0.55 0.03,0.50 C0.06,0.45 0.06,0.41 0.03,0.36
  C0.06,0.31 0.06,0.27 0.03,0.22 C0.06,0.18 0.06,0.14 0.03,0.08 Z`;

export default function StampCard({ stamps, flipEnabled = true, rewardMessage }) {
  const [flipped, setFlipped] = useState(false);
  const totalStamps = stamps || 0;
  const progress = totalStamps > 0 && totalStamps % STAMP_GOAL === 0 ? STAMP_GOAL : totalStamps % STAMP_GOAL;
  const readyForReward = totalStamps > 0 && totalStamps % STAMP_GOAL === 0;

  const back = (
    <div className="stamp-card-face stamp-card-back">
      <div className="stamp-card-back-panel">
        <div className="stamp-card-headline">Your {STAMP_GOAL}th matcha's on us!</div>
        <div className="stamp-grid">
          {Array.from({ length: STAMP_GOAL }, (_, i) => (
            <div key={i} className="stamp-slot">
              <img className="stamp-slot-star" src="/assets/stamp-star.png" alt="" />
              {i < progress && <img className="stamp-slot-cow" src="/assets/stamp-cow.png" alt="stamp" />}
            </div>
          ))}
        </div>
        {readyForReward && <div className="reward-banner">{rewardMessage}</div>}
      </div>
    </div>
  );

  const svgDefs = (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <clipPath id="stampScallop" clipPathUnits="objectBoundingBox">
          <path d={SCALLOP_PATH} />
        </clipPath>
      </defs>
    </svg>
  );

  if (!flipEnabled) {
    return (
      <div className="stamp-card-static">
        {svgDefs}
        {back}
      </div>
    );
  }

  return (
    <div
      className={`stamp-card-flip ${flipped ? 'flipped' : ''}`}
      onClick={() => setFlipped(f => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setFlipped(f => !f); }}
    >
      {svgDefs}
      <div className="stamp-card-flip-inner">
        <div className="stamp-card-face stamp-card-front">
          <div className="stamp-card-front-panel">
            <div className="stamp-card-tagline">for moocha addicts!</div>
            <img className="stamp-card-wordmark" src="/assets/stamp-card-front-logo.png" alt="Moocha" />
          </div>
          <img className="stamp-card-star-deco" src="/assets/stamp-card-stars.png" alt="" />
        </div>
        {back}
      </div>
    </div>
  );
}
