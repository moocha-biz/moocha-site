import React from 'react';

export default function Header({ onOpenPin }) {
  return (
    <header>
      <div className="brand">
        <img src="/assets/logo-full.png" alt="moocha" className="header-logo" />
        <div>
          <div className="brand-sub">matcha &amp; friends 🐮</div>
        </div>
      </div>
      <button className="gear" onClick={onOpenPin} aria-label="Staff login">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="#2F5233" strokeWidth="1.8" />
          <path d="M19.4 13a7.4 7.4 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3.6h-4l-.4 2.4a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4L6.6 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9c.5.4 1.1.75 1.7 1l.4 2.4h4l.4-2.4c.6-.25 1.2-.6 1.7-1l2.3.9 2-3.4-2-1.5z" stroke="#2F5233" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
    </header>
  );
}
