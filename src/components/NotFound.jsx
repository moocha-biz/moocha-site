import { Link } from 'react-router-dom';
import useDocumentMeta from '../lib/useDocumentMeta.js';

export default function NotFound() {
  useDocumentMeta('Page Not Found — Moocha', 'This page doesn\'t exist.', { noindex: true });

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--cream)', padding: 24, textAlign: 'center',
    }}>
      <div>
        <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--green-dark)', marginBottom: 8 }}>
          nothing here 🍃
        </div>
        <div style={{ fontSize: 14, color: 'var(--brand)', marginBottom: 22, maxWidth: 320 }}>
          This page doesn't exist — but the menu does.
        </div>
        <Link
          to="/menu"
          style={{
            display: 'inline-block', background: 'var(--green)', color: '#fff', textDecoration: 'none',
            padding: '13px 30px', borderRadius: 18, fontFamily: "'Baloo 2', sans-serif", fontWeight: 700,
            fontSize: 15, boxShadow: '0 5px 0 var(--green-dark)',
          }}
        >Back to menu</Link>
      </div>
    </div>
  );
}
