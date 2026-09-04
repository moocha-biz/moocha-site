import React from 'react';

function DoodleIcon() {
  return (
    <svg viewBox="0 0 64 64" width="34" height="34" fill="none">
      <path d="M20 26h24l-2.5 24a4 4 0 0 1-4 3.6H26.5a4 4 0 0 1-4-3.6L20 26z" stroke="#85A573" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M20 26c0-2.2 2.7-4 12-4s12 1.8 12 4" stroke="#85A573" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M23 32q9 5 18 0" stroke="#85A573" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.6" />
      <path d="M32 15c2-4 6-5 9-3" stroke="#85A573" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function ItemThumb({ item }) {
  if (item.photo) {
    return (
      <div className="item-thumb"><img src={item.photo} alt={item.name} /></div>
    );
  }
  return (
    <div className="item-thumb" style={{ background: 'linear-gradient(155deg,#EEF4E9,#D3E2C6)' }}>
      <DoodleIcon />
    </div>
  );
}
