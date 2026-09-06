import { useState } from 'react';
import { STAMP_GOAL } from '../store.jsx';

export default function StampCard({ stamps, flipEnabled = true, rewardMessage }) {
  const [flipped, setFlipped] = useState(false);
  const totalStamps = stamps || 0;
  const progress = totalStamps > 0 && totalStamps % STAMP_GOAL === 0 ? STAMP_GOAL : totalStamps % STAMP_GOAL;
  const readyForReward = totalStamps > 0 && totalStamps % STAMP_GOAL === 0;

  const back = (
    <div className="stamp-card-face stamp-card-back">
      <img className="stamp-card-border-img" src="/assets/stamp-card/21.svg" alt="" />
      {/* The headline art bakes in "8th" — STAMP_GOAL is a fixed constant,
          not user-editable, so this stays in sync without being dynamic. */}
      <img className="stamp-card-headline" src="/assets/stamp-card/18.svg" alt={`Your ${STAMP_GOAL}th matcha's on us!`} />
      <div className="stamp-grid">
        {Array.from({ length: STAMP_GOAL }, (_, i) => (
          <div key={i} className="stamp-slot">
            <img className="stamp-slot-star" src="/assets/stamp-card/15.svg" alt="" />
            {i < progress && <img className="stamp-slot-cow" src="/assets/stamp-card/12.svg" alt="stamp" />}
          </div>
        ))}
      </div>
      {readyForReward && <div className="reward-banner">{rewardMessage}</div>}
    </div>
  );

  if (!flipEnabled) {
    return (
      <div className="stamp-card-static">
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
      <div className="stamp-card-flip-inner">
        <div className="stamp-card-face stamp-card-front">
          <img className="stamp-card-border-img" src="/assets/stamp-card/20.svg" alt="" />
          <img className="stamp-card-tagline" src="/assets/stamp-card/19.svg" alt="for moocha addicts!" />
          <img className="stamp-card-wordmark" src="/assets/stamp-card/17.svg" alt="Moocha" />
          <img className="stamp-card-star-deco" src="/assets/stamp-card/16.svg" alt="" />
        </div>
        {back}
      </div>
    </div>
  );
}
