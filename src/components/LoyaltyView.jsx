import { useMoocha, STAMP_GOAL } from '../store.jsx';
import StampCard from './StampCard.jsx';

// Just the loyalty side of the account now — stamp card + who this stamp
// card belongs to. Order list/status/Telegram notifications moved to
// OrdersView.jsx (its own /orders page), since those are about an order,
// not about the rewards program itself.
export default function LoyaltyView() {
  const { myProfile, myStamps } = useMoocha();
  const totalStamps = myStamps || 0;

  return (
    <>
      {myProfile && (myProfile.name || myProfile.phone) && (
        <>
          <div className="section-label">Your details</div>
          <div className="section-note" style={{ marginBottom: 20 }}>
            {[myProfile.name, myProfile.phone].filter(Boolean).join(' · ')}
          </div>
        </>
      )}
      <div className="section-label">Your stamp card</div>
      <div className="section-note">1 stamp per drink · {STAMP_GOAL} stamps = a free drink · tap the card to flip it</div>
      <StampCard stamps={totalStamps} flipEnabled rewardMessage="free drink unlocked - mention it at pickup!" />
    </>
  );
}
