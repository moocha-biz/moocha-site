import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

// Keeps every existing tab/setTab consumer (TabBar, desktop nav, the
// Stripe-redirect handler in App.jsx) working unchanged — `tab` now just
// derives from the URL instead of being independent state, and `setTab`
// navigates instead of setting a local flag. That's what makes /menu,
// /cart and /rewards real, bookmarkable, shareable URLs.
function tabFromPath(pathname) {
  if (pathname.startsWith('/cart')) return 'cart';
  if (pathname.startsWith('/rewards')) return 'loyalty';
  return 'menu';
}
function pathFromTab(tab) {
  if (tab === 'cart') return '/cart';
  if (tab === 'loyalty') return '/rewards';
  return '/menu';
}

export function MoochaProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  // ---------------- customer-facing state ----------------
  const [tab, setTabState] = useState(() => tabFromPath(location.pathname));
  useEffect(() => { setTabState(tabFromPath(location.pathname)); }, [location.pathname]);
  const setTab = useCallback((next) => navigate(pathFromTab(next)), [navigate]);
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
  // isAdmin is derived from a real Supabase Auth session, not a plain flag
  // — so it persists across reloads (the session is stored by supabase-js)
  // and every write RLS now gates on `to authenticated` actually means
  // something, instead of just hiding the UI for an anon-key holder who
  // could otherwise call the API directly.
  const [session, setSession] = useState(null);
  const isAdmin = !!session;
  const [adminTab, setAdminTab] = useState('sales');

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = sb.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

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
    return data.map(r => ({ id: r.id, name: r.name, phone: r.phone, date: r.date, items: r.items, total: Number(r.total), notes: r.notes, status: r.status, orderType: r.order_type, collectedAt: r.collected_at, stripeSessionId: r.stripe_session_id, refundedAt: r.refunded_at, refundId: r.refund_id }));
  }, [noteSupabaseError]);

  const fetchSettings = useCallback(async () => {
    if (!sb) return getLocal('demo_settings', DEFAULT_SETTINGS);
    const { data, error } = await sb.from('settings').select('*').eq('id', 'main').single();
    if (error) { noteSupabaseError('Loading settings', error); return DEFAULT_SETTINGS; }
    if (!data) return DEFAULT_SETTINGS;
    return {
      paymentEnabled: data.payment_enabled, stallPhone: data.stall_phone, stallName: data.stall_name,
      collectionStart: data.collection_start, collectionEnd: data.collection_end,
      preorderCloseAt: data.preorder_close_at,
    };
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

  const menuToggleHidden = useCallback(async (cat, id) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      next.categories[cat] = next.categories[cat].map(i => i.id === id ? { ...i, isHidden: !i.isHidden } : i);
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const current = menu.categories[cat]?.find(i => i.id === id);
    const { error } = await sb.from('items').update({ is_hidden: !current?.isHidden }).eq('id', id);
    if (error) { noteSupabaseError('Updating item', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const menuSaveItem = useCallback(async ({ id, category, name, desc, price, iced, soldout, isHidden, photo, sugarLevels, preorderLimit, walkinLimit, customTags }) => {
    if (!sb) {
      const next = { categories: { ...menu.categories } };
      for (const c in next.categories) next.categories[c] = next.categories[c].filter(i => i.id !== id);
      if (!next.categories[category]) next.categories[category] = [];
      const newItem = {
        id, name, desc, price, iced, soldout: soldout || false, isHidden: isHidden || false, sugarLevels,
        preorderLimit: preorderLimit ?? null, walkinLimit: walkinLimit ?? null, customTags: customTags || [],
      };
      if (photo) newItem.photo = photo;
      next.categories[category] = [...next.categories[category], newItem];
      setMenu(next); setLocal('demo_menu', next);
      return;
    }
    const { error } = await sb.rpc('save_menu_item', {
      p_id: id, p_category: category, p_name: name, p_desc: desc, p_price: price,
      p_iced: iced, p_photo: photo || null, p_sugar_levels: sugarLevels,
      p_preorder_limit: preorderLimit ?? null, p_walkin_limit: walkinLimit ?? null, p_custom_tags: customTags || [],
    });
    if (error) { noteSupabaseError('Saving item', error); return; }
    setMenu(await fetchMenuData());
  }, [sb, menu, noteSupabaseError, fetchMenuData]);

  const persistSettings = useCallback(async (nextSettings) => {
    if (!sb) { setLocal('demo_settings', nextSettings); return; }
    const { error } = await sb.from('settings').update({
      payment_enabled: nextSettings.paymentEnabled,
      stall_phone: nextSettings.stallPhone, stall_name: nextSettings.stallName,
      preorder_close_at: nextSettings.preorderCloseAt,
    }).eq('id', 'main');
    if (error) noteSupabaseError('Saving settings', error);
  }, [noteSupabaseError]);

  // Also resets both stock counters to 0 (see set_collection_hours) — that's
  // what marks the start of a new sale week.
  const setCollectionHours = useCallback(async (start, end) => {
    if (!sb) {
      const next = { ...settings, collectionStart: start, collectionEnd: end };
      setLocal('demo_settings', next);
      setSettings(next);
      return;
    }
    const { error } = await sb.rpc('set_collection_hours', { p_start: start, p_end: end });
    if (error) { noteSupabaseError('Saving collection hours', error); return; }
    setSettings(await fetchSettings());
    setMenu(await fetchMenuData());
  }, [sb, settings, noteSupabaseError, fetchSettings, fetchMenuData]);

  // Admin's walk-in order builder: books walk-in stock and awards the
  // loyalty stamp immediately, since a walk-in is collected on the spot.
  const logWalkinOrder = useCallback(async ({ id, name, phone, items, total, notes }) => {
    if (!sb) {
      const list = getLocal('demo_orders', []);
      list.unshift({ id, name, phone, date: new Date().toISOString(), items, total, notes, status: 'Received', orderType: 'walkin', collectedAt: null });
      setLocal('demo_orders', list);
      setOrders(list);
      return { error: null };
    }
    const { error } = await sb.rpc('log_walkin_order', {
      p_id: id, p_name: name || '', p_phone: phone || '', p_items: items, p_total: total, p_notes: notes || '',
    });
    if (error) { noteSupabaseError('Logging walk-in order', error); return { error }; }
    setOrders(await fetchOrders());
    setMenu(await fetchMenuData());
    return { error: null };
  }, [sb, fetchOrders, fetchMenuData, noteSupabaseError]);

  // Staff mark a preorder collected; this is what actually awards the
  // loyalty stamp for preorders now (see mark_order_collected).
  const markOrderCollected = useCallback(async (id) => {
    if (!sb) {
      const list = getLocal('demo_orders', []);
      const o = list.find(x => x.id === id);
      if (o && o.status === 'Received') {
        o.status = 'Collected';
        o.collectedAt = new Date().toISOString();
        setLocal('demo_orders', list);
        setOrders([...list]);
      }
      return;
    }
    const { error } = await sb.rpc('mark_order_collected', { p_id: id });
    if (error) { noteSupabaseError('Marking order collected', error); return; }
    setOrders(await fetchOrders());
    setCustomers(await fetchCustomers());
  }, [sb, fetchOrders, fetchCustomers, noteSupabaseError]);

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

  // Stripe-paid orders go through the refund-order edge function (it's the
  // only place that can actually call stripe.refunds.create, since only it
  // holds the Stripe secret key); cash/walk-in orders have no Stripe
  // payment to reverse, so they call refund_order() directly instead.
  const refundOrder = useCallback(async (order) => {
    if (!sb) {
      const list = getLocal('demo_orders', []);
      const o = list.find(x => x.id === order.id);
      if (o && (o.status === 'Received' || o.status === 'Collected')) {
        o.status = 'Refunded';
        o.refundedAt = new Date().toISOString();
        setLocal('demo_orders', list);
        setOrders([...list]);
      }
      return { error: null };
    }
    if (order.stripeSessionId) {
      const { data, error } = await sb.functions.invoke('refund-order', { body: { orderId: order.id } });
      if (error || data?.error) {
        const message = data?.error || error?.message || 'Refund failed';
        noteSupabaseError('Refunding order', { message });
        return { error: message };
      }
    } else {
      const { error } = await sb.rpc('refund_order', { p_id: order.id });
      if (error) { noteSupabaseError('Refunding order', error); return { error: error.message }; }
    }
    setOrders(await fetchOrders());
    setCustomers(await fetchCustomers());
    setMenu(await fetchMenuData());
    return { error: null };
  }, [fetchOrders, fetchCustomers, fetchMenuData, noteSupabaseError]);

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

  // Customers never sign in, so their own stamp count and order history
  // can't come from the customers/orders tables directly anymore (those
  // are staff-only now) — these two narrow RPCs are the replacement.
  const refreshMyLoyalty = useCallback(async (profile) => {
    const p = profile !== undefined ? profile : myProfile;
    if (!p) { setMyStamps(0); return; }
    if (!sb) {
      const list = getLocal('demo_customers', []);
      const mine = list.find(c => c.phone === p.phone);
      setMyStamps(mine ? (mine.stamps || 0) : 0);
      return;
    }
    // p_token is the per-customer secret handed back once in the receipt
    // right after a paid order (see get_order_receipt / stripe-webhook) —
    // without it, a phone number alone (an 8-digit, brute-forceable SG
    // mobile number) can't unlock someone else's stamp count.
    const { data, error } = await sb.rpc('get_my_stamps', { p_phone: p.phone, p_token: p.customerToken || null });
    if (error) { noteSupabaseError('Checking your stamp card', error); setMyStamps(0); return; }
    setMyStamps(data || 0);
  }, [myProfile, noteSupabaseError]);

  const fetchMyOrders = useCallback(async (phone, token) => {
    if (!phone) return [];
    if (!sb) return getLocal('demo_orders', []).filter(o => o.phone === phone);
    const { data, error } = await sb.rpc('get_my_orders', { p_phone: phone, p_token: token || null });
    if (error) { noteSupabaseError('Loading your orders', error); return []; }
    return (data || []).map(r => ({ id: r.id, date: r.date, items: r.items, total: Number(r.total), status: r.status }));
  }, [noteSupabaseError]);

  const saveProfile = useCallback((profile) => {
    setMyProfile(profile);
    setLocal('moocha_my_profile', profile);
  }, []);

  // Called once, right after a paid order's receipt confirms a
  // `customerToken` — merges it into the local profile so later
  // get_my_stamps/get_my_orders calls can prove the phone is actually
  // theirs instead of just guessing it.
  const saveCustomerToken = useCallback((token) => {
    if (!token) return;
    setMyProfile(prev => {
      const next = { ...(prev || {}), customerToken: token };
      setLocal('moocha_my_profile', next);
      return next;
    });
  }, []);

  // ---------------- cart helpers ----------------
  const saveCartLocal = useCallback((next) => setLocal('moocha_cart', next), []);
  const cartSubtotal = cart.reduce((s, l) => s + l.lineTotal, 0);

  // Adding the same item + sugar level combo again merges into the
  // existing line (qty bumped) instead of creating a second, confusing
  // duplicate line for the same drink.
  const addLineToCart = useCallback((line) => {
    setCart(prev => {
      const dupeIdx = prev.findIndex(l => l.itemId === line.itemId && l.sugar === line.sugar);
      const next = dupeIdx === -1
        ? [...prev, line]
        : prev.map((l, i) => i === dupeIdx ? { ...l, qty: l.qty + line.qty, lineTotal: l.lineTotal + line.lineTotal } : l);
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

  const updateLine = useCallback((lineId, patch) => {
    setCart(prev => {
      const next = prev.map(l => (l.lineId === lineId ? { ...l, ...patch, lineId } : l));
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
  // Deliberately doesn't fetch orders — that table is staff-only now, so
  // an anon customer session couldn't read it anyway. refreshAdminData()
  // (below) is the staff-only equivalent that does load it.
  const loadShared = useCallback(async () => {
    const [s, m] = await Promise.all([fetchSettings(), fetchMenuData()]);
    setSettings(s);
    setMenu(m);
    setActiveCat(prev => prev || Object.keys(m.categories)[0]);
    await refreshMyLoyalty(myProfile);
  }, [fetchSettings, fetchMenuData, refreshMyLoyalty, myProfile]);

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

  // Fires whenever a session appears — a fresh sign-in, or a persisted
  // session restored on reload — so both paths load admin data the same
  // way without PinModal needing to call anything explicitly.
  useEffect(() => {
    if (!isAdmin) return;
    refreshAdminData();
    setAdminTab('sales');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const logOut = useCallback(async () => {
    if (sb) await sb.auth.signOut();
    navigate('/admin');
  }, [navigate]);

  const signInStaff = useCallback(async (email, password) => {
    if (!sb) {
      const ok = password === getLocal(DEMO_PASSPHRASE_KEY, DEMO_DEFAULT_PASSPHRASE);
      if (ok) setSession({ demo: true });
      return { error: ok ? null : { message: 'Wrong passphrase' } };
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const changeStaffPassword = useCallback(async (newPassword) => {
    if (!sb) { setLocal(DEMO_PASSPHRASE_KEY, newPassword); return { error: null }; }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) noteSupabaseError('Changing password', error);
    return { error };
  }, [noteSupabaseError]);

  // Recomputed on every render (settings.paymentEnabled changing, or the
  // 8s background poll refreshing settings, both trigger one) — no timer
  // of its own needed for the cutoff to "take effect" within a few seconds.
  const ordersOpen = settings.paymentEnabled && (!settings.preorderCloseAt || Date.now() < new Date(settings.preorderCloseAt).getTime());

  const value = {
    sb,
    // customer state
    tab, setTab, activeCat, setActiveCat,
    cart, cartSubtotal, addLineToCart, cartQty, updateLine, removeLine, clearCart,
    myProfile, saveProfile, saveCustomerToken, myStamps, refreshMyLoyalty, fetchMyOrders,
    // shared state
    menu, setMenu, settings, setSettings, ordersOpen, orders, setOrders, customers, setCustomers,
    lastSupabaseError, setLastSupabaseError,
    // admin
    isAdmin, adminTab, setAdminTab, logOut, refreshAdminData, signInStaff, changeStaffPassword,
    // toast
    toast, showToast,
    // backend actions
    fetchOrders, fetchSettings, fetchMenuData, fetchCustomers,
    menuAddCategory, menuDeleteCategory, menuToggleSoldout, menuToggleHidden, menuDeleteItem, menuSaveItem,
    persistSettings, setCollectionHours, deleteOrder, refundOrder, logWalkinOrder, markOrderCollected,
    setCustomerStamps, deleteCustomerRecord,
    noteSupabaseError,
  };

  return <MoochaContext.Provider value={value}>{children}</MoochaContext.Provider>;
}

export { STAMP_GOAL, DEFAULT_SUGAR_LEVELS };
