import React, { useState } from 'react';
import { useMoocha, DEFAULT_SUGAR_LEVELS } from '../../store.jsx';

function RowsEditor({ label, rows, setRows, withPrice, addLabel, emptyNote }) {
  const update = (i, field, value) => {
    const next = [...rows];
    next[i] = { ...next[i], [field]: value };
    setRows(next);
  };
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const add = () => setRows([...rows, withPrice ? { id: label + Date.now(), name: '', price: 0 } : '']);

  return (
    <div className="field">
      <label>{label}</label>
      {rows.length === 0 && <div className="section-note" style={{ marginBottom: 8 }}>{emptyNote}</div>}
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          {withPrice ? (
            <>
              <input
                value={row.name || ''} placeholder="Name"
                style={{ flex: 2, border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)' }}
                onChange={e => update(i, 'name', e.target.value)}
              />
              <input
                type="number" step="0.10" value={row.price ?? 0} placeholder="$"
                style={{ flex: 1, border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)' }}
                onChange={e => update(i, 'price', parseFloat(e.target.value) || 0)}
              />
            </>
          ) : (
            <input
              value={row} placeholder="e.g. 50%"
              style={{ flex: 1, border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)' }}
              onChange={e => { const next = [...rows]; next[i] = e.target.value; setRows(next); }}
            />
          )}
          <button className="icon-btn danger" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn-secondary" onClick={add}>{addLabel}</button>
    </div>
  );
}

export default function ItemEditorSheet({ cat, item, onClose, onSaved }) {
  const { sb, menuSaveItem, showToast } = useMoocha();
  const [name, setName] = useState(item?.name || '');
  const [desc, setDesc] = useState(item?.desc || '');
  const [price, setPrice] = useState(item ? item.price : '');
  const [category, setCategory] = useState(cat);
  const [iced, setIced] = useState(item?.iced || false);
  const [milks, setMilks] = useState(item?.milks ? item.milks.map(o => ({ ...o })) : []);
  const [toppings, setToppings] = useState(item?.toppings ? item.toppings.map(o => ({ ...o })) : []);
  const [sugarLevels, setSugarLevels] = useState(item?.sugarLevels?.length ? [...item.sugarLevels] : [...DEFAULT_SUGAR_LEVELS]);
  const [photoUrl, setPhotoUrl] = useState(item?.photo || null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose a JPEG or PNG'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Please choose an image under 5MB'); return; }

    if (sb) {
      setUploading(true);
      showToast('Uploading photo…');
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `item-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('menu-photos').upload(path, file, { upsert: true });
      setUploading(false);
      if (error) { console.error(error); showToast('Upload failed — try again'); return; }
      const { data } = sb.storage.from('menu-photos').getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
      showToast('Photo uploaded ✓');
    } else {
      const reader = new FileReader();
      reader.onload = () => setPhotoUrl(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedCat = category.trim();
    if (!trimmedName || !trimmedCat) { showToast('Name and category are required'); return; }

    const cleanMilks = milks.filter(m => (m.name || '').trim()).map(m => ({ id: m.id, name: m.name.trim(), price: m.price || 0 }));
    const cleanToppings = toppings.filter(t => (t.name || '').trim()).map(t => ({ id: t.id, name: t.name.trim(), price: t.price || 0 }));
    const cleanSugarLevels = sugarLevels.map(s => s.trim()).filter(Boolean);

    await menuSaveItem({
      id: item ? item.id : ('i' + Date.now()),
      category: trimmedCat, name: trimmedName, desc: desc.trim(), price: parseFloat(price) || 0, iced,
      soldout: item ? item.soldout : false, photo: photoUrl,
      milks: cleanMilks, toppings: cleanToppings, sugarLevels: cleanSugarLevels,
    });
    onSaved?.();
    onClose();
  };

  return (
    <>
      <div className="sheet-close" />
      <div className="sheet-title">{item ? 'Edit item' : 'New item'}</div>
      <div className="field"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field"><label>Description</label><textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div className="field"><label>Price ($)</label><input type="number" step="0.10" value={price} onChange={e => setPrice(e.target.value)} /></div>
      <div className="field"><label>Category</label><input value={category} onChange={e => setCategory(e.target.value)} /></div>
      <div className="field">
        <label>Thumbnail photo</label>
        <div style={{ width: 84, height: 84, borderRadius: 16, overflow: 'hidden', background: 'var(--mint)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {photoUrl ? <img src={photoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <span style={{ fontSize: 11, color: 'var(--green)' }}>No photo</span>}
        </div>
        <input type="file" accept="image/jpeg,image/png" onChange={handlePhotoFile} disabled={uploading} />
        {photoUrl && <div className="remove-link" style={{ marginTop: 8 }} onClick={() => setPhotoUrl(null)}>Remove photo</div>}
        <div className="section-note" style={{ marginTop: 6 }}>JPEG or PNG, ideally square. {sb ? 'Uploaded to your Supabase storage.' : 'Demo mode: saved to this device only until Supabase is connected.'}</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, marginBottom: 16 }}>
        <input type="checkbox" checked={iced} onChange={e => setIced(e.target.checked)} style={{ width: 18, height: 18 }} /> Served iced
      </label>
      <RowsEditor label="Sweetness levels for this drink" rows={sugarLevels} setRows={setSugarLevels} withPrice={false} addLabel="+ Add sweetness level" emptyNote="None yet — this drink won't offer a sweetness choice until you add one." />
      <RowsEditor label="Milk options for this drink" rows={milks} setRows={setMilks} withPrice addLabel="+ Add milk option" emptyNote="None yet — this drink won't offer a milk choice until you add one." />
      <RowsEditor label="Toppings for this drink" rows={toppings} setRows={setToppings} withPrice addLabel="+ Add topping" emptyNote="None yet — this drink won't offer a topping until you add one." />
      <button className="btn-primary" onClick={save}><span>Save item</span><span>→</span></button>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
    </>
  );
}
