import { useEffect, useRef, useState } from 'react';
import { useMoocha } from '../store.jsx';

export default function PinModal({ onClose }) {
  const { signInStaff, showToast, sb } = useMoocha();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const submit = async () => {
    if (!password) return;
    if (sb && !email) { showToast('Enter your staff email'); return; }
    setBusy(true);
    // isAdmin flips on its own once the session lands — this component
    // doesn't need to do anything else on success, AdminRoute re-renders
    // to the dashboard automatically.
    const { error } = await signInStaff(email, password);
    setBusy(false);
    if (error) { showToast(error.message || 'Wrong email or password'); setPassword(''); }
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title" style={{ textAlign: 'center' }}>Staff login 🔒</div>
      <div className="sheet-sub" style={{ textAlign: 'center' }}>{sb ? 'Sign in with the staff account' : 'Enter the staff passphrase'}</div>
      {sb && (
        <div className="field">
          <input
            ref={emailRef}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
        </div>
      )}
      <div className="field">
        <input
          ref={sb ? null : emailRef}
          type="password"
          placeholder="Password"
          style={sb ? undefined : { textAlign: 'center', letterSpacing: '1px' }}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      <button className="btn-primary" disabled={busy} onClick={submit}><span>{busy ? 'Signing in…' : 'Unlock'}</span><span>→</span></button>
      <button className="btn-secondary" onClick={onClose}>Back to menu</button>
    </>
  );
}
