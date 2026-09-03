import React from 'react';

export default function Overlay({ show, onClose, center = false, cardModal = false, floatClose = false, children }) {
  return (
    <div
      className={`overlay ${show ? 'show' : ''} ${center ? 'center' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sheet-wrap">
        <div className={`sheet ${cardModal ? 'card-modal' : ''}`}>
          {show && children}
        </div>
        {/* Lives outside the sheet's own scrolling div, so unlike a button
            placed inside the scrollable content, this can never scroll out
            of view — it's genuinely fixed to the sheet's corner. */}
        {show && floatClose && <button className="sheet-float-close" onClick={onClose} aria-label="Close">✕</button>}
      </div>
    </div>
  );
}
