import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useMoocha } from './store.jsx';
import CustomerApp from './components/CustomerApp.jsx';
import NotFound from './components/NotFound.jsx';
import Toast from './components/Toast.jsx';
import Overlay from './components/Overlay.jsx';
import PaymentResultModal from './components/PaymentResultModal.jsx';
import { fireConfetti } from './components/Confetti.jsx';

// Lazy-loaded so the admin dashboard's own dependencies (Chart.js, every
// admin tab/sheet, the menu-photo uploader, …) never ship in the bundle a
// customer downloads just to browse the menu and order a drink — the vast
// majority of visits. Only a staff member actually navigating to /admin
// pays for that download.
const AdminRoute = lazy(() => import('./components/AdminRoute.jsx'));

export default function App() {
  const { clearCart, refreshMyLoyalty, setTab, claimRewards, showToast } = useMoocha();
  const [paymentResult, setPaymentResult] = useState(null);

  // Handles the redirect back from Stripe after checkout succeeds/cancels.
  // The order itself is written by the stripe-webhook function once Stripe
  // confirms payment — not here — so a customer can't fake "I've paid".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_success')) {
      clearCart();
      window.history.replaceState({}, '', window.location.pathname);
      refreshMyLoyalty().then(() => setTab('loyalty'));
      fireConfetti();
      setPaymentResult({ type: 'success', orderId: params.get('order_id'), sessionId: params.get('session_id') });
    } else if (params.get('stripe_canceled')) {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('cart');
      setPaymentResult({ type: 'canceled' });
    } else if (params.get('claim')) {
      // A staff-issued link for a customer whose stamps predate any online
      // order (e.g. walk-in-only) — see claimRewards in store.jsx. Single-
      // use: this exact URL stops working the moment it succeeds once.
      const code = params.get('claim');
      window.history.replaceState({}, '', window.location.pathname);
      claimRewards(code).then(({ name, error }) => {
        setTab('loyalty');
        if (error) showToast(error);
        else { fireConfetti(); showToast(name ? `Welcome back, ${name}! Your rewards are linked ✓` : 'Your rewards are linked ✓'); }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Routes>
        <Route
          path="/admin"
          element={
            <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--cream)' }} />}>
              <AdminRoute />
            </Suspense>
          }
        />
        <Route path="/" element={<CustomerApp />} />
        <Route path="/menu" element={<CustomerApp />} />
        <Route path="/cart" element={<CustomerApp />} />
        <Route path="/rewards" element={<CustomerApp />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Overlay show={!!paymentResult} onClose={() => setPaymentResult(null)} center cardModal>
        <PaymentResultModal
          result={paymentResult}
          onClose={() => setPaymentResult(null)}
          onRetry={() => setPaymentResult(null)}
        />
      </Overlay>
      <Toast />
    </>
  );
}
