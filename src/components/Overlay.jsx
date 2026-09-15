export default function Overlay({ show, onClose, center = false, cardModal = false, floatClose = false, fullOnMobile = false, children }) {
  return (
    <div
      className={`overlay ${show ? 'show' : ''} ${center ? 'center' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sheet-wrap">
        <div className={`sheet ${cardModal ? 'card-modal' : ''} ${fullOnMobile ? 'full-mobile' : ''}`}>
          {show && children}
        </div>
        {/* Lives outside the sheet's own scrolling div, so unlike a button
            placed inside the scrollable content, this can never scroll out
            of view — it's genuinely fixed to the sheet's corner. Positioned
            relative to sheet-wrap, not the sheet itself — card-modal insets
            the sheet 20px from sheet-wrap's edge, so it needs its own
            offset or it floats outside the card instead of on its corner. */}
        {show && floatClose && (
          <button className={`sheet-float-close ${cardModal ? 'card-modal-close' : ''}`} onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>
    </div>
  );
}
