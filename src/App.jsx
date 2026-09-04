import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useMoocha } from './store.jsx';
import CustomerApp from './components/CustomerApp.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import NotFound from './components/NotFound.jsx';
import Toast from './components/Toast.jsx';
import Overlay from './components/Overlay.jsx';
import PaymentResultModal from './components/PaymentResultModal.jsx';
import { fireConfetti } from './components/Confetti.jsx';

export default function App() {
  const { clearCart, refreshMyLoyalty, setTab } = useMoocha();
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
      setPaymentResult({ type: 'success', orderId: params.get('order_id') });
    } else if (params.get('stripe_canceled')) {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('cart');
      setPaymentResult({ type: 'canceled' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Routes>
        <Route path="/admin" element={<AdminRoute />} />
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
