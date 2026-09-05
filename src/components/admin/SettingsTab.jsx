import { useState } from 'react';
import { useMoocha } from '../../store.jsx';

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time,
// but settings stores/returns real UTC timestamptz strings — these two
// convert between the two without going through a UTC-normalizing Date
// parse that would shift the displayed time.
function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInputValue(local) {
  if (!local) return null;
  return new Date(local).toISOString();
}

export default function SettingsTab() {
  const { sb, settings, setSettings, persistSettings, setCollectionHours, changeStaffPassword, staffEmail, showToast } = useMoocha();
  const [phone, setPhone] = useState(settings.stallPhone);
  const [name, setName] = useState(settings.stallName);
  const [collectionStart, setCollectionStart] = useState(toLocalInputValue(settings.collectionStart));
  const [collectionEnd, setCollectionEnd] = useState(toLocalInputValue(settings.collectionEnd));
  const [closeAt, setCloseAt] = useState(toLocalInputValue(settings.preorderCloseAt));
  const [ppNew, setPpNew] = useState('');
  const [ppConfirm, setPpConfirm] = useState('');
  const [ppVisible, setPpVisible] = useState(false);

  // Each save button stays disabled until its own fields diverge again
  // from what's actually saved — comparing straight against `settings`
  // works because a successful save immediately updates it, so the
  // comparison naturally goes back to "nothing to save" right after.
  const stallInfoDirty = phone !== settings.stallPhone || name !== settings.stallName;
  const autoCloseDirty = closeAt !== toLocalInputValue(settings.preorderCloseAt);
  const collectionHoursDirty = collectionStart !== toLocalInputValue(settings.collectionStart) || collectionEnd !== toLocalInputValue(settings.collectionEnd);

  const togglePayment = async () => {
    const next = { ...settings, paymentEnabled: !settings.paymentEnabled };
    setSettings(next);
    await persistSettings(next);
  };

  const saveSettings = async () => {
    const next = { ...settings, stallPhone: phone.trim(), stallName: name.trim() };
    setSettings(next);
    await persistSettings(next);
    showToast('Settings saved ✓');
  };

  const saveAutoClose = async () => {
    const next = { ...settings, preorderCloseAt: fromLocalInputValue(closeAt) };
    setSettings(next);
    await persistSettings(next);
    showToast(closeAt ? 'Auto-close time set ✓' : 'Auto-close cleared — orders stay open until you toggle them off');
  };

  const saveCollectionHours = async () => {
    if (!collectionStart || !collectionEnd) { showToast('Set both a start and end time'); return; }
    if (!window.confirm("This starts a new sale week — every item's preorder and walk-in stock counts reset to 0. Continue?")) return;
    await setCollectionHours(fromLocalInputValue(collectionStart), fromLocalInputValue(collectionEnd));
    showToast('Collection hours saved — stock counts reset ✓');
  };

  const submitChangePassword = async () => {
    if (!ppNew) { showToast('Enter a new password'); return; }
    if (ppNew.length < 6) { showToast('Use at least 6 characters'); return; }
    // This is a single shared login every staff member uses — a typo here
    // locks everyone out until someone resets it via the Supabase
    // Dashboard, so it's worth catching before submitting, not after.
    if (ppNew !== ppConfirm) { showToast("Passwords don't match"); return; }
    const { error } = await changeStaffPassword(ppNew);
    if (!error) { showToast('Password changed ✓'); setPpNew(''); setPpConfirm(''); }
    else showToast(error.message || 'Could not change password');
  };

  return (
    <>
      <div className="settings-section">
        <div className="section-label" style={{ marginTop: 0 }}>Accepting orders</div>
        <div className="settings-row" style={{ boxShadow: 'none', padding: '10px 0', marginBottom: 0 }}>
          <div>
            <div className="admin-item-name">Accepting orders</div>
            <div className="sub" style={{ fontSize: 12, color: 'var(--brand)' }}>Turn off to pause the customer app</div>
          </div>
          <div
            className={`toggle ${settings.paymentEnabled ? 'on' : ''}`}
            role="switch" aria-checked={settings.paymentEnabled} aria-label="Accepting orders" tabIndex={0}
            onClick={togglePayment}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePayment(); } }}
          ><div className="knob" /></div>
        </div>
        {settings.preorderCloseAt && (
          <div className="section-note" style={{ marginTop: 4 }}>
            {settings.paymentEnabled && Date.now() < new Date(settings.preorderCloseAt).getTime()
              ? `Will auto-close at ${new Date(settings.preorderCloseAt).toLocaleString()}`
              : `Auto-close time (${new Date(settings.preorderCloseAt).toLocaleString()}) has passed — orders are closed`}
          </div>
        )}
        <div className="field" style={{ marginTop: 10 }}>
          <label>Auto-close preorders at</label>
          <input type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)} />
        </div>
        <div className="section-note" style={{ marginTop: -6 }}>Orders close on their own at this time — no need to remember to flip the toggle above. Leave blank and save to remove the cutoff.</div>
        <button className="btn-secondary" style={{ marginBottom: 0 }} disabled={!autoCloseDirty} onClick={saveAutoClose}>{closeAt ? 'Save auto-close time' : 'Clear auto-close time'}</button>
      </div>

      <div className="settings-section">
        <div className="section-label" style={{ marginTop: 0 }}>Stall info</div>
        <div className="field"><label>PayNow number</label><input value={phone} onChange={e => setPhone(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Stall name (shown on QR)</label><input value={name} onChange={e => setName(e.target.value)} /></div>
        <button className="btn-primary" style={{ marginTop: 14 }} disabled={!stallInfoDirty} onClick={saveSettings}><span>Save settings</span><span>→</span></button>
        {!sb && <div className="demo-banner" style={{ marginTop: 14, marginBottom: 0 }}>Connect Supabase (see README.md) to make this real across every device.</div>}
      </div>

      <div className="settings-section">
        <div className="section-label" style={{ marginTop: 0 }}>Collection hours</div>
        <div className="section-note">Shown to customers so they know when to pick up this week's preorders. Saving this also resets every item's sold-this-week counts to 0.</div>
        <div className="field"><label>Collection starts</label><input type="datetime-local" value={collectionStart} onChange={e => setCollectionStart(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Collection ends</label><input type="datetime-local" value={collectionEnd} onChange={e => setCollectionEnd(e.target.value)} /></div>
        <button className="btn-primary" style={{ marginTop: 14 }} disabled={!collectionHoursDirty} onClick={saveCollectionHours}><span>Save collection hours</span><span>→</span></button>
      </div>

      <div className="settings-section" style={{ marginBottom: 0 }}>
        <div className="section-label" style={{ marginTop: 0 }}>Your password</div>
        <div className="section-note">
          {staffEmail ? `Changes the password for your own login (${staffEmail}) — no one else's.` : 'Changes the password for your own login only — no one else\'s.'}
        </div>
        <div className="field">
          <label>New password</label>
          <input type={ppVisible ? 'text' : 'password'} value={ppNew} onChange={e => setPpNew(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Confirm new password</label>
          <input type={ppVisible ? 'text' : 'password'} value={ppConfirm} onChange={e => setPpConfirm(e.target.value)} />
        </div>
        <div style={{ textAlign: 'right', marginTop: 6 }}>
          <span className="edit-link" onClick={() => setPpVisible(v => !v)}>{ppVisible ? 'Hide' : 'Show'} passwords</span>
        </div>
        <button className="btn-secondary" style={{ marginTop: 8, marginBottom: 0 }} disabled={!ppNew || !ppConfirm} onClick={submitChangePassword}>Change password</button>
      </div>
    </>
  );
}
