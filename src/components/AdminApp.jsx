import React from 'react';
import { useMoocha } from '../store.jsx';
import SalesTab from './admin/SalesTab.jsx';
import OrdersTab from './admin/OrdersTab.jsx';
import CustomersTab from './admin/CustomersTab.jsx';
import MenuEditorTab from './admin/MenuEditorTab.jsx';
import SettingsTab from './admin/SettingsTab.jsx';

const TABS = [
  { id: 'sales', label: 'Sales' },
  { id: 'orders', label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'menu', label: 'Menu' },
  { id: 'settings', label: 'Settings' },
];

export default function AdminApp() {
  const { sb, adminTab, setAdminTab, refreshAdminData, logOut, lastSupabaseError, setLastSupabaseError } = useMoocha();

  return (
    <div className="app" id="adminApp" style={{ display: 'flex' }}>
      <div className="admin-header">
        <div className="heading">🐮 moocha staff</div>
        <div className="admin-header-btns">
          <button className="admin-back" onClick={() => refreshAdminData().then(() => setAdminTab(adminTab))}>↻ Refresh</button>
          <button className="admin-back" onClick={logOut}>Log out</button>
        </div>
      </div>
      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`admin-tab ${adminTab === t.id ? 'active' : ''}`} onClick={() => setAdminTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="admin-main">
        {!sb && <div className="demo-banner">⚠️ Demo mode — Supabase isn't connected yet, so this data is only on this device. See README.md.</div>}
        {lastSupabaseError && (
          <div className="demo-banner" style={{ background: 'var(--blush)', color: '#8a3a2a' }}>
            ⚠️ {lastSupabaseError}
            <span className="remove-link" style={{ color: '#8a3a2a', display: 'block', marginTop: 4 }} onClick={() => setLastSupabaseError(null)}>Dismiss</span>
          </div>
        )}
        {adminTab === 'sales' && <SalesTab />}
        {adminTab === 'orders' && <OrdersTab />}
        {adminTab === 'customers' && <CustomersTab />}
        {adminTab === 'menu' && <MenuEditorTab />}
        {adminTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
