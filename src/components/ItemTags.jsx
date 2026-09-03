import React from 'react';

// Auto-picks readable text color for whatever background an admin picks,
// so a custom tag never ends up as light text on a light color (or the
// reverse).
function contrastText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#2F5233';
  const n = m[1];
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#2F5233' : '#ffffff';
}

export default function ItemTags({ tags }) {
  if (!tags || tags.length === 0) return null;
  return (
    <>
      {tags.filter(t => t?.text).map((tag, i) => (
        <div key={i} className="custom-tag" style={{ background: tag.color || '#4C8558', color: contrastText(tag.color) }}>
          {tag.text}
        </div>
      ))}
    </>
  );
}
