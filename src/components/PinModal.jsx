import { useEffect, useRef, useState } from 'react';
import { useMoocha } from '../store.jsx';

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: -2 }}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.5 6.7C4 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.8-1.2M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a15.6 15.6 0 0 1-2.8 3.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PinModal({ onClose }) {
  const { signInStaff, showToast, sb } = useMoocha();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const clearError = () => { if (error) setError(''); };

  const submit = async () => {
    if (!password) return;
    if (sb && !email) { showToast('Enter your staff email'); return; }
    setBusy(true);
    // isAdmin flips on its own once the session lands — this component
    // doesn't need to do anything else on success, AdminRoute re-renders
    // to the dashboard automatically.
    const { error: err } = await signInStaff(email, password);
    setBusy(false);
    if (err) {
      const msg = err.message || 'Wrong email or password';
      setError(msg);
      showToast(msg);
      setPassword('');
    }
  };

  const requestReset = async () => {
    if (!email.trim()) { showToast('Enter your email first, then tap "Forgot password?"'); emailRef.current?.focus(); return; }
    setResetting(true);
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/admin` });
    setResetting(false);
    showToast(err ? (err.message || "Couldn't send reset email") : 'Check your email for a password reset link');
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title" style={{ textAlign: 'center' }}><LockIcon /> Staff login</div>
      <div className="sheet-sub" style={{ textAlign: 'center', marginBottom: 10 }}>{sb ? 'Sign in with the staff account' : 'Enter the staff passphrase'}</div>
      {sb && (
        <div className={`field ${error ? 'error' : ''}`}>
          <label htmlFor="staff-email">Email</label>
          <input
            id="staff-email"
            ref={emailRef}
            type="email"
            placeholder="you@moocha.com"
            value={email}
            onChange={e => { setEmail(e.target.value); clearError(); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
        </div>
      )}
      <div className={`field ${error ? 'error' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label htmlFor="staff-password" style={{ marginBottom: 0 }}>{sb ? 'Password' : 'Passphrase'}</label>
          {sb && <span className="edit-link" onClick={requestReset}>{resetting ? 'Sending…' : 'Forgot password?'}</span>}
        </div>
        <div className="field-input-wrap" style={{ marginTop: 6 }}>
          <input
            id="staff-password"
            ref={sb ? null : emailRef}
            type={showPassword ? 'text' : 'password'}
            placeholder={sb ? 'Password' : 'Staff passphrase'}
            style={{ paddingRight: 42, ...(sb ? {} : { textAlign: 'center', letterSpacing: '1px' }) }}
            value={password}
            onChange={e => { setPassword(e.target.value); clearError(); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          <button
            type="button"
            className="field-toggle-icon"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            <EyeIcon open={showPassword} />
          </button>
        </div>
        {error && <div className="field-error-msg">{error}</div>}
      </div>
      <button className="btn-primary" disabled={busy} onClick={submit}><span>{busy ? 'Signing in…' : 'Unlock'}</span><span>→</span></button>
      <button className="btn-secondary" onClick={onClose}>Back to menu</button>
    </>
  );
}
