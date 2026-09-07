import { loadStripe } from '@stripe/stripe-js';

// Paste your Stripe publishable key here, or (recommended) set it as
// VITE_STRIPE_PUBLISHABLE_KEY in a .env file — see README.md, Part 4.
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

// loadStripe caches its own result, so calling it once at module scope
// (instead of per-checkout) means every checkout reuses the same instance.
export const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;
