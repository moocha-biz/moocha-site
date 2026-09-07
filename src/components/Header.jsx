export default function Header() {
  return (
    <header>
      <div className="brand">
        <img src="/assets/logo-full.png" alt="moocha" className="header-logo" />
        <div>
          <div className="brand-sub">matcha &amp; friends 🐮</div>
        </div>
      </div>
      <a className="header-social" href="https://t.me/moochacha" target="_blank" rel="noreferrer" aria-label="Join our Telegram channel">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
        </svg>
      </a>
    </header>
  );
}
