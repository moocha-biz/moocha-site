# moocha — React rewrite

This is a full rewrite of the original single-file `index.html` app as a
modern React + Vite project, with a responsive layout: it still looks like
a mobile app on phones, but on tablets/desktops it becomes a real
e-commerce layout — a multi-column menu with a persistent cart sidebar
instead of the bottom "Cart" tab.

All the original functionality is preserved: menu browsing & item
customization, cart, checkout (manual PayNow + optional Stripe), the
loyalty stamp card, and the full staff dashboard (sales chart, orders,
customers, menu editor with photo upload, settings, passphrase-gated
access).

## Project structure

```
src/
  store.jsx           – all app state + Supabase/localStorage-backed actions (React context)
  App.jsx             – top-level switch between customer app and admin dashboard
  data/defaults.js     – default menu, settings, modifiers
  lib/supabaseClient.js, lib/storage.js
  components/          – customer-facing UI (menu, cart, checkout, loyalty, tabs, modals)
  components/admin/    – staff dashboard tabs (sales, orders, customers, menu editor, settings)
  styles.css           – all styling, including the responsive/desktop rules at the bottom
```

## 1. Install & run locally

```bash
npm install
npm run dev
```

## 2. Add your images

Copy your `assets/` folder (logo-cow.png, logo-full.png, item photos, etc.)
into `public/assets/` — same filenames as before. Anything in `public/` is
served as-is at the site root (e.g. `public/assets/logo-cow.png` →
`/assets/logo-cow.png`).

## 3. Connect Supabase (optional but recommended)

Without it, the app runs in **demo mode**: everything is saved to
`localStorage` only on the current device/browser.

1. Create a free project at https://supabase.com
2. Run your `supabase-schema.sql` in the SQL editor (same schema as the
   original app — orders, menu, settings, customers tables + the
   `check_staff_pin` / `set_staff_pin` functions).
3. Create a `.env` file in the project root:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. Restart `npm run dev` (or rebuild) so Vite picks up the env vars.

The default demo staff passphrase is `QUEENraks!` until Supabase is
connected — change it from Settings once you're live.

## 4. Optional: card payments via Stripe

Same as before — set up the `create-checkout-session` Supabase Edge
Function and a `stripe-webhook` function that writes the order once
Stripe confirms payment. Nothing in the React app needs to change for
this; `startStripeCheckout` already calls `sb.functions.invoke(...)`.

## 5. Build & deploy

```bash
npm run build
```

This outputs a static site to `dist/`. Deploy that folder to Netlify,
Vercel, or any static host — same as the original single-file version.
