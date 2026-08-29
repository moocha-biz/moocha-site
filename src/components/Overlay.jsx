import React from 'react';

export default function Overlay({ show, onClose, center = false, cardModal = false, children }) {
  return (
    <div
      className={`overlay ${show ? 'show' : ''} ${center ? 'center' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`sheet ${cardModal ? 'card-modal' : ''}`}>
        {show && children}
      </div>
    </div>
  );
}
