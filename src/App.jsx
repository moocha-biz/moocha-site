import React, { useEffect } from 'react';
import { useMoocha } from './store.jsx';
import CustomerApp from './components/CustomerApp.jsx';
import AdminApp from './components/AdminApp.jsx';
import Toast from './components/Toast.jsx';
import { fireConfetti } from './components/Confetti.jsx';

export default function App() {
  const { isAdmin, enterAdmin, exitAdmin, clearCart, refreshMyLoyalty, setTab, showToast } = useMoocha();

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
      showToast('Payment received — see you soon! 🎉');
    } else if (params.get('stripe_canceled')) {
      window.history.replaceState({}, '', window.location.pathname);
      showToast('Checkout canceled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {isAdmin ? <AdminApp onExit={exitAdmin} /> : <CustomerApp onOpenAdmin={enterAdmin} />}
      <Toast />
    </>
  );
}
