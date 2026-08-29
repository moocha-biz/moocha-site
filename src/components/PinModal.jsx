import React, { useEffect, useRef, useState } from 'react';
import { useMoocha } from '../store.jsx';

export default function PinModal({ onClose, onUnlocked }) {
  const { checkStaffPassphrase, showToast } = useMoocha();
  const [val, setVal] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!val) return;
    const ok = await checkStaffPassphrase(val);
    if (ok) { onClose(); onUnlocked(); }
    else { showToast('Wrong passphrase'); setVal(''); inputRef.current?.focus(); }
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title" style={{ textAlign: 'center' }}>Staff login 🔒</div>
      <div className="sheet-sub" style={{ textAlign: 'center' }}>Enter the staff passphrase</div>
      <div className="field">
        <input
          ref={inputRef}
          type="password"
          placeholder="Passphrase"
          style={{ textAlign: 'center', letterSpacing: '1px' }}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      <button className="btn-primary" onClick={submit}><span>Unlock</span><span>→</span></button>
    </>
  );
}
