import React, { useState } from 'react';
import { useMoocha } from '../../store.jsx';

export default function SettingsTab() {
  const { sb, settings, setSettings, persistSettings, changeStaffPassphrase, showToast } = useMoocha();
  const [phone, setPhone] = useState(settings.stallPhone);
  const [name, setName] = useState(settings.stallName);
  const [ppOld, setPpOld] = useState('');
  const [ppNew, setPpNew] = useState('');

  const togglePayment = async () => {
    const next = { ...settings, paymentEnabled: !settings.paymentEnabled };
    setSettings(next);
    await persistSettings(next);
  };

  const saveSettings = async () => {
    const next = { ...settings, stallPhone: phone.trim(), stallName: name.trim() };
    setSettings(next);
    await persistSettings(next);
    showToast('Settings saved');
  };

  const submitChangePassphrase = async () => {
    if (!ppOld || !ppNew) { showToast('Fill in both fields'); return; }
    if (ppNew.length < 6) { showToast('Use at least 6 characters'); return; }
    const ok = await changeStaffPassphrase(ppOld, ppNew);
    if (ok) { showToast('Passphrase changed ✓'); setPpOld(''); setPpNew(''); }
    else showToast('Current passphrase was wrong');
  };

  return (
    <>
      <div className="settings-row">
        <div>
          <div className="admin-item-name">Accepting orders</div>
          <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>Turn off to pause the customer app</div>
        </div>
        <div className={`toggle ${settings.paymentEnabled ? 'on' : ''}`} onClick={togglePayment}><div className="knob" /></div>
      </div>
      <div className="field"><label>PayNow number</label><input value={phone} onChange={e => setPhone(e.target.value)} /></div>
      <div className="field"><label>Stall name (shown on QR)</label><input value={name} onChange={e => setName(e.target.value)} /></div>
      <button className="btn-primary" onClick={saveSettings}><span>Save settings</span><span>→</span></button>
      {!sb && <div className="demo-banner" style={{ marginTop: 14 }}>Connect Supabase (see README.md) to make this real across every device.</div>}

      <div className="section-label" style={{ marginTop: 26 }}>Staff passphrase</div>
      <div className="section-note">Used to unlock this dashboard from the gear icon.</div>
      <div className="field"><label>Current passphrase</label><input type="password" value={ppOld} onChange={e => setPpOld(e.target.value)} /></div>
      <div className="field"><label>New passphrase</label><input type="password" value={ppNew} onChange={e => setPpNew(e.target.value)} /></div>
      <button className="btn-secondary" onClick={submitChangePassphrase}>Change passphrase</button>
    </>
  );
}
