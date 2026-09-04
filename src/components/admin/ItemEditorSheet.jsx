import React, { useState } from 'react';
import { useMoocha, DEFAULT_SUGAR_LEVELS } from '../../store.jsx';
import ItemTags from '../ItemTags.jsx';

const TAG_COLOR_PRESETS = ['#4C8558', '#F2B705', '#FF9E8B', '#85A573', '#2F5233', '#FED7FE'];

function TagsEditor({ tags, setTags }) {
  const update = (i, field, value) => {
    const next = [...tags];
    next[i] = { ...next[i], [field]: value };
    setTags(next);
  };
  const remove = (i) => setTags(tags.filter((_, idx) => idx !== i));
  const add = () => setTags([...tags, { text: '', color: TAG_COLOR_PRESETS[tags.length % TAG_COLOR_PRESETS.length] }]);

  return (
    <div className="field">
      <label>Custom tags (e.g. "New!", "Bestseller")</label>
      {tags.length === 0 && <div className="section-note" style={{ marginBottom: 8 }}>None yet — add one to badge this item on the menu.</div>}
      {tags.map((tag, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input
            type="color" value={tag.color || '#4C8558'} onChange={e => update(i, 'color', e.target.value)}
            style={{ width: 40, height: 38, border: '2px solid var(--line)', borderRadius: 12, padding: 2, background: 'var(--paper)', flexShrink: 0, cursor: 'pointer' }}
          />
          <input
            value={tag.text || ''} placeholder="Tag text" maxLength={24}
            style={{ flex: 1, border: '2px solid var(--line)', background: 'var(--paper)', borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 13.5, color: 'var(--green-dark)' }}
            onChange={e => update(i, 'text', e.target.value)}
          />
          <button className="icon-btn danger" title="Remove" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      {tags.some(t => t.text) && (
        <div style={{ marginBottom: 8 }}>
          <div className="section-note" style={{ marginBottom: 4 }}>Preview</div>
          <ItemTags tags={tags} />
        </div>
      )}
      <button className="btn-secondary" onClick={add}>+ Add tag</button>
    </div>
  );
}

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
          <button className="icon-btn danger" title="Remove" onClick={() => remove(i)}>✕</button>
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
  const [sugarLevels, setSugarLevels] = useState(item?.sugarLevels?.length ? [...item.sugarLevels] : [...DEFAULT_SUGAR_LEVELS]);
  const [preorderLimit, setPreorderLimit] = useState(item?.preorderLimit ?? '');
  const [walkinLimit, setWalkinLimit] = useState(item?.walkinLimit ?? '');
  const [customTags, setCustomTags] = useState(item?.customTags?.length ? item.customTags.map(t => ({ ...t })) : []);
  const [photoUrl, setPhotoUrl] = useState(item?.photo || null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose a JPEG or PNG'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Please choose an image under 5MB'); return; }

    // Show the picked photo immediately from the local file, instead of
    // making the admin stare at "No photo" until the network upload
    // finishes — then swap it for the real hosted URL once that's done.
    const localPreview = URL.createObjectURL(file);
    setPhotoUrl(localPreview);

    if (sb) {
      setUploading(true);
      showToast('Uploading photo…');
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `item-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('menu-photos').upload(path, file, { upsert: true });
      setUploading(false);
      if (error) { console.error(error); showToast(`Upload failed — ${error.message || 'try again'}`); URL.revokeObjectURL(localPreview); setPhotoUrl(item?.photo || null); return; }
      const { data } = sb.storage.from('menu-photos').getPublicUrl(path);
      URL.revokeObjectURL(localPreview);
      setPhotoUrl(data.publicUrl);
      showToast('Photo uploaded ✓');
    } else {
      const reader = new FileReader();
      reader.onload = () => { URL.revokeObjectURL(localPreview); setPhotoUrl(reader.result); };
      reader.readAsDataURL(file);
    }
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedCat = category.trim();
    if (!trimmedName || !trimmedCat) { showToast('Name and category are required'); return; }

    const cleanSugarLevels = sugarLevels.map(s => s.trim()).filter(Boolean);
    const cleanTags = customTags.filter(t => (t.text || '').trim()).map(t => ({ text: t.text.trim().slice(0, 24), color: t.color || '#4C8558' }));

    await menuSaveItem({
      id: item ? item.id : ('i' + Date.now()),
      category: trimmedCat, name: trimmedName, desc: desc.trim(), price: parseFloat(price) || 0, iced,
      soldout: item ? item.soldout : false, isHidden: item ? item.isHidden : false, photo: photoUrl,
      sugarLevels: cleanSugarLevels,
      preorderLimit: preorderLimit === '' ? null : Math.max(0, parseInt(preorderLimit, 10) || 0),
      walkinLimit: walkinLimit === '' ? null : Math.max(0, parseInt(walkinLimit, 10) || 0),
      customTags: cleanTags,
    });
    onSaved?.();
    onClose();
    showToast(item ? 'Item saved ✓' : 'Item added ✓');
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
      <div className="field">
        <label>Preorder stock limit this week{item?.preorderSold ? ` (${item.preorderSold} sold)` : ''}</label>
        <input type="number" min="0" value={preorderLimit} placeholder="Leave blank for unlimited" onChange={e => setPreorderLimit(e.target.value)} />
      </div>
      <div className="field">
        <label>Walk-in stock limit this week{item?.walkinSold ? ` (${item.walkinSold} sold)` : ''}</label>
        <input type="number" min="0" value={walkinLimit} placeholder="Leave blank for unlimited" onChange={e => setWalkinLimit(e.target.value)} />
      </div>
      <div className="section-note" style={{ marginTop: -8, marginBottom: 16 }}>Both reset to 0 sold whenever you save new collection hours in Settings.</div>
      <TagsEditor tags={customTags} setTags={setCustomTags} />
      <RowsEditor label="Sweetness levels for this drink" rows={sugarLevels} setRows={setSugarLevels} withPrice={false} addLabel="+ Add sweetness level" emptyNote="None yet — this drink won't offer a sweetness choice until you add one." />
      <button className="btn-primary" onClick={save}><span>Save item</span><span>→</span></button>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
    </>
  );
}
