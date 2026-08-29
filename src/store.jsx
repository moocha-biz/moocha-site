import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { sb } from './lib/supabaseClient.js';
import { getLocal, setLocal } from './lib/storage.js';
import {
  DEFAULT_MENU, DEFAULT_SETTINGS, DEFAULT_SUGAR_LEVELS, STAMP_GOAL,
  DEMO_PASSPHRASE_KEY, DEMO_DEFAULT_PASSPHRASE,
} from './data/defaults.js';

const MoochaContext = createContext(null);

export function useMoocha() {
  const ctx = useContext(MoochaContext);
  if (!ctx) throw new Error('useMoocha must be used inside <MoochaProvider>');
  return ctx;
}

export function MoochaProvider({ children }) {
  // ---------------- customer-facing state ----------------
  const [tab, setTab] = useState('menu');
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState(() => getLocal('moocha_cart', []));
  const [myProfile, setMyProfile] = useState(() => getLocal('moocha_my_profile', null));
  const [myStamps, setMyStamps] = useState(0);

  // ---------------- shared/backend-derived state ----------------
  const [menu, setMenu] = useState(DEFAULT_MENU);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [lastSupabaseError, setLastSupabaseError] = useState(null);

  // ---------------- admin / staff state ----------------
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState('sales');

  // ---------------- UI/overlay state ----------------
  const [toast, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 1700);
  }, []);

  const noteSupabaseError = useCallback((label, error) => {
    console.error(label, error);
    setLastSupabaseError(`${label}: ${error?.message || JSON.stringify(error)}`);
  }, []);

  // ---------------- fetchers (mirror the original supabase-or-localStorage calls) ----------------
  const fetchOrders = useCallback(async () => {
    if (!sb) return getLocal('demo_orders', []);
    const { data, error } = await sb.from('orders').select('*').order('date', { ascending: false });
    if (error) { noteSupabaseError('Loading orders', error); return []; }
    return data.map(r => ({ id: r.id, name: r.name, phone: r.phone, date: r.date, items: r.items, total: Number(r.total), notes: r.notes, status: r.status }));
  }, [noteSupabaseError]);

  const fetchSettings = useCallback(async () => {
    if (!sb) return getLocal('demo_settings', DEFAULT_SETTINGS);
    const { data, error } = await sb.from('settings').select('*').eq('id', 'main').single();
    if (error) { noteSupabaseError('Loading settings', error); return DEFAULT_SETTINGS; }
    if (!data) return DEFAULT_SETTINGS;
    return { paymentEnabled: data.payment_enabled, stallPhone: data.stall_phone, stallName: data.stall_name };
  }, [noteSupabaseError]);

  const fetchMenuData = useCallback(async () => {
    if (!sb) return getLocal('demo_menu', DEFAULT_MENU);
    const { data, error } = await sb.rpc('get_menu');
    if (error) { noteSupabaseError('Loading menu', error); return DEFAULT_MENU; }
    return data || DEFAULT_MENU;
  }, [noteSupabaseError]);

  const fetchCustomers = useCallback(async () => {
    if (!sb) return getLocal('demo_customers', []);
    const { data, error } = await sb.from('customers').select('*');
    if (error) { noteSupabaseError('Loading customers', error); return []; }
    return data;
  }, [noteSupabaseError]);

  // ---------------- menu editing (admin) ----------------
  // The menu lives in real relational tables (categories/items/item_milks/
  // item_toppings/item_sugar_levels) — each of these does one targeted
  // write instead of the old "rewrite the entire catalog blob" pattern.
  // Demo mode (no sb) has no real backend, so it keeps mutating the local
  // {categories: {name: [items]}} tree directly, same as before.
  const menuAddCategory = useCallback(async (name) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      if (!next.categories[name]) next.categories[name] = [];
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const { error } = await sb.from('categories').insert({ id: 'cat_' + Date.now(), name, sort_order: Date.now() });
    if (error) { noteSupabaseError('Adding category', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuDeleteCategory = useCallback(async (name) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      delete next.categories[name];
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const { error } = await sb.from('categories').delete().eq('name', name);
    if (error) { noteSupabaseError('Deleting category', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuToggleSoldout = useCallback(async (cat, id) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      next.categories[cat] = next.categories[cat].map(i => i.id === id ? { ...i, soldout: !i.soldout } : i);
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const current = menu.categories[cat]?.find(i => i.id === id);
    const { error } = await sb.from('items').update({ soldout: !current?.soldout }).eq('id', id);
    if (error) { noteSupabaseError('Updating item', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuDeleteItem = useCallback(async (cat, id) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      next.categories[cat] = next.categories[cat].filter(i => i.id !== id);
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const { error } = await sb.from('items').delete().eq('id', id);
    if (error) { noteSupabaseError('Deleting item', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuMoveItem = useCallback(async (cat, id, dir) => {
    const items = menu.categories[cat] || [];
    const i = items.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const reordered = [...items];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];

    if (!sb) {
      const next = { categories: { ...menu.categories, [cat]: reordered } };
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const results = await Promise.all(reordered.map((it, idx) => sb.from('items').update({ sort_order: idx }).eq('id', it.id)));
    const failed = results.find(r => r.error);
    if (failed) { noteSupabaseError('Reordering menu', failed.error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuSaveItem = useCallback(async ({ id, category, name, desc, price, iced, soldout, photo, icon, milks, toppings, sugarLevels }) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      for (const c in next.categories) next.categories[c] = next.categories[c].filter(i => i.id !== id);
      if (!next.categories[category]) next.categories[category] = [];
      const newItem = { id, name, desc, price, iced, soldout: soldout || false, milks, toppings, sugarLevels };
      if (photo) newItem.photo = photo; else newItem.icon = icon || 'matcha';
      next.categories[category] = [...next.categories[category], newItem];
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const { error } = await sb.rpc('save_menu_item', {
      p_id: id, p_category: category, p_name: name, p_desc: desc, p_price: price,
      p_iced: iced, p_photo: photo || null, p_icon: photo ? null : (icon || 'matcha'),
      p_milks: milks, p_toppings: toppings, p_sugar_levels: sugarLevels,
    });
    if (error) { noteSupabaseError('Saving item', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const persistSettings = useCallback(async (nextSettings) => {
    if (!sb) { setLocal('demo_settings', nextSettings); return; }
    const { error } = await sb.from('settings').update({
      payment_enabled: nextSettings.paymentEnabled,
      stall_phone: nextSettings.stallPhone, stall_name: nextSettings.stallName,
    }).eq('id', 'main');
    if (error) noteSupabaseError('Saving settings', error);
  }, [noteSupabaseError]);

  const insertOrder = useCallback(async (order) => {
    if (!sb) {
      const list = getLocal('demo_orders', []);
      list.unshift(order); setLocal('demo_orders', list);
      setOrders(list);
      return;
    }
    const { error } = await sb.from('orders').insert({ id: order.id, name: order.name, phone: order.phone, date: order.date, items: order.items, total: order.total, notes: order.notes, status: order.status });
    if (error) { noteSupabaseError('Saving your order', error); showToast("Couldn't save your order — please tell staff"); }
    setOrders(await fetchOrders());
  }, [fetchOrders, noteSupabaseError, showToast]);

  const deleteOrder = useCallback(async (id) => {
    if (!sb) {
      let list = getLocal('demo_orders', []);
      list = list.filter(o => o.id !== id);
      setLocal('demo_orders', list);
      setOrders(list);
      return;
    }
    const { error } = await sb.from('orders').delete().eq('id', id);
    if (error) noteSupabaseError('Deleting order', error);
    setOrders(await fetchOrders());
  }, [fetchOrders, noteSupabaseError]);

  const bumpCustomerStamp = useCallback(async (phone, name) => {
    if (!sb) {
      const list = getLocal('demo_customers', []);
      const c = list.find(x => x.phone === phone);
      if (c) { c.stamps = (c.stamps || 0) + 1; c.name = name; } else { list.push({ phone, name, stamps: 1 }); }
      setLocal('demo_customers', list);
      return;
    }
    const { data: existing, error: selError } = await sb.from('customers').select('*').eq('phone', phone).maybeSingle();
    if (selError) { noteSupabaseError('Checking your stamp card', selError); return; }
    if (existing) {
      const { error } = await sb.from('customers').update({ stamps: (existing.stamps || 0) + 1, name, updated_at: new Date().toISOString() }).eq('phone', phone);
      if (error) noteSupabaseError('Updating your stamp card', error);
    } else {
      const { error } = await sb.from('customers').insert({ phone, name, stamps: 1 });
      if (error) noteSupabaseError('Starting your stamp card', error);
    }
  }, [noteSupabaseError]);

  const setCustomerStamps = useCallback(async (phone, stamps) => {
    if (!sb) {
      const list = getLocal('demo_customers', []);
      const c = list.find(x => x.phone === phone);
      if (c) c.stamps = stamps;
      setLocal('demo_customers', list);
      return;
    }
    const { error } = await sb.from('customers').update({ stamps, updated_at: new Date().toISOString() }).eq('phone', phone);
    if (error) noteSupabaseError('Saving stamp count', error);
  }, [noteSupabaseError]);

  const deleteCustomerRecord = useCallback(async (phone) => {
    if (!sb) {
      let list = getLocal('demo_customers', []);
      list = list.filter(c => c.phone !== phone);
      setLocal('demo_customers', list);
      return;
    }
    const { error } = await sb.from('customers').delete().eq('phone', phone);
    if (error) noteSupabaseError('Deleting customer', error);
  }, [noteSupabaseError]);

  const checkStaffPassphrase = useCallback(async (candidate) => {
    if (!sb) return candidate === getLocal(DEMO_PASSPHRASE_KEY, DEMO_DEFAULT_PASSPHRASE);
    const { data, error } = await sb.rpc('check_staff_pin', { candidate });
    if (error) { noteSupabaseError('Checking passphrase', error); return false; }
    return data === true;
  }, [noteSupabaseError]);

  const changeStaffPassphrase = useCallback(async (oldPass, newPass) => {
    if (!sb) {
      if (oldPass !== getLocal(DEMO_PASSPHRASE_KEY, DEMO_DEFAULT_PASSPHRASE)) return false;
      setLocal(DEMO_PASSPHRASE_KEY, newPass);
      return true;
    }
    const { data, error } = await sb.rpc('set_staff_pin', { old_pin: oldPass, new_pin: newPass });
    if (error) { noteSupabaseError('Changing passphrase', error); return false; }
    return data === true;
  }, [noteSupabaseError]);

  const refreshMyLoyalty = useCallback(async (profile) => {
    const p = profile !== undefined ? profile : myProfile;
    if (!p) { setMyStamps(0); return; }
    const list = await fetchCustomers();
    const mine = list.find(c => c.phone === p.phone);
    setMyStamps(mine ? (mine.stamps || 0) : 0);
  }, [fetchCustomers, myProfile]);

  const saveProfile = useCallback((profile) => {
    setMyProfile(profile);
    setLocal('moocha_my_profile', profile);
  }, []);

  // ---------------- cart helpers ----------------
  const saveCartLocal = useCallback((next) => setLocal('moocha_cart', next), []);
  const cartSubtotal = cart.reduce((s, l) => s + l.lineTotal, 0);

  const addLineToCart = useCallback((line) => {
    setCart(prev => {
      const next = [...prev, line];
      saveCartLocal(next);
      return next;
    });
  }, [saveCartLocal]);

  const cartQty = useCallback((lineId, d) => {
    setCart(prev => {
      const next = prev.map(l => {
        if (l.lineId !== lineId) return l;
        const unit = l.lineTotal / l.qty;
        const qty = Math.max(1, l.qty + d);
        return { ...l, qty, lineTotal: unit * qty };
      });
      saveCartLocal(next);
      return next;
    });
  }, [saveCartLocal]);

  const removeLine = useCallback((lineId) => {
    setCart(prev => {
      const next = prev.filter(l => l.lineId !== lineId);
      saveCartLocal(next);
      return next;
    });
  }, [saveCartLocal]);

  const clearCart = useCallback(() => {
    setCart([]);
    saveCartLocal([]);
  }, [saveCartLocal]);

  // ---------------- initial + polling load ----------------
  const loadShared = useCallback(async () => {
    const [s, m, o] = await Promise.all([fetchSettings(), fetchMenuData(), fetchOrders()]);
    setSettings(s);
    setMenu(m);
    setOrders(o);
    setActiveCat(prev => prev || Object.keys(m.categories)[0]);
    await refreshMyLoyalty(myProfile);
  }, [fetchSettings, fetchMenuData, fetchOrders, refreshMyLoyalty, myProfile]);

  useEffect(() => {
    loadShared();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      if (!isAdmin) {
        setSettings(await fetchSettings());
        setMenu(await fetchMenuData());
      }
    }, 8000);
    return () => clearInterval(id);
  }, [isAdmin, fetchSettings, fetchMenuData]);

  const refreshAdminData = useCallback(async () => {
    const [o, m, s, c] = await Promise.all([fetchOrders(), fetchMenuData(), fetchSettings(), fetchCustomers()]);
    setOrders(o); setMenu(m); setSettings(s); setCustomers(c);
  }, [fetchOrders, fetchMenuData, fetchSettings, fetchCustomers]);

  const enterAdmin = useCallback(async () => {
    setIsAdmin(true);
    await refreshAdminData();
    setAdminTab('sales');
  }, [refreshAdminData]);

  const exitAdmin = useCallback(() => {
    setIsAdmin(false);
  }, []);

  const value = {
    sb,
    // customer state
    tab, setTab, activeCat, setActiveCat,
    cart, cartSubtotal, addLineToCart, cartQty, removeLine, clearCart,
    myProfile, saveProfile, myStamps, refreshMyLoyalty,
    // shared state
    menu, setMenu, settings, setSettings, orders, setOrders, customers, setCustomers,
    lastSupabaseError, setLastSupabaseError,
    // admin
    isAdmin, adminTab, setAdminTab, enterAdmin, exitAdmin, refreshAdminData,
    // toast
    toast, showToast,
    // backend actions
    fetchOrders, fetchSettings, fetchMenuData, fetchCustomers,
    menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuDeleteItem, menuMoveItem, menuSaveItem,
    persistSettings, insertOrder, deleteOrder,
    bumpCustomerStamp, setCustomerStamps, deleteCustomerRecord,
    checkStaffPassphrase, changeStaffPassphrase,
    noteSupabaseError,
  };

  return <MoochaContext.Provider value={value}>{children}</MoochaContext.Provider>;
}

export { STAMP_GOAL, DEFAULT_SUGAR_LEVELS };
