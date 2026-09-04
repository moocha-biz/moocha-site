import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMoocha } from '../store.jsx';
import useDocumentMeta from '../lib/useDocumentMeta.js';
import PinModal from './PinModal.jsx';
import AdminApp from './AdminApp.jsx';

// A real, bookmarkable /admin route — but staff-only and blocked from
// search engines (robots.txt + noindex here) since there's no SEO upside
// to indexing a login screen, and every reason not to.
export default function AdminRoute() {
  const { isAdmin } = useMoocha();
  const navigate = useNavigate();

  useDocumentMeta('Staff Login — Moocha', 'Staff dashboard for Moocha.', { noindex: true });

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 20 }}>
        <div className="sheet card-modal" style={{ position: 'static', width: '100%', maxWidth: 420, animation: 'none' }}>
          <PinModal onClose={() => navigate('/')} />
        </div>
      </div>
    );
  }

  return <AdminApp />;
}
