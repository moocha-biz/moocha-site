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

Five Supabase Edge Functions handle this — `create-checkout-session`
(creates the Stripe Checkout session when a customer taps "Pay with
PayNow"; also handles redeeming a free drink alongside other paid items,
discounting it to a $0 Stripe line item), `stripe-webhook` (the only place
a paid order actually gets written, once Stripe confirms payment),
`refund-order` (the only place staff can refund a Stripe-paid order from
the admin dashboard's order detail view — a cash/walk-in/fully-redeemed
order has no Stripe payment, so refunding one of those just updates the
database directly), `get-order-payment` (read-only — pulls payment
status/method/receipt for the order detail view's Stripe section, so staff
don't have to look it up in the Stripe Dashboard by hand; the detail view
also links straight to the matching Checkout Session there), and
`redeem-order` (places a preorder that's *entirely* covered by a
customer's loyalty reward — cart total $0 after redeeming — since Stripe
Checkout can't process a $0 total at all; this writes the order directly,
the same way the admin dashboard's walk-in flow logs a cash order). Both
redemption paths re-verify eligibility (stamps ≥ goal) against the
database using the customer's `access_token`, never trusting the client.
Nothing in the React app needs to change for this; `CartView`/
`CheckoutSheet`/`OrderDetailSheet` already call `sb.functions.invoke(...)`.

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and
   link it to your project:
   ```bash
   supabase login
   supabase link --project-ref your-project-ref
   ```
2. Set the required secrets:
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
   The service role key (not the anon key) is under Project Settings >
   API — it must only ever live here, never in the React app.
3. Deploy all five functions:
   ```bash
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook
   supabase functions deploy refund-order
   supabase functions deploy get-order-payment
   supabase functions deploy redeem-order
   ```
4. In the Stripe Dashboard, add a webhook endpoint pointing to
   `https://your-project-ref.supabase.co/functions/v1/stripe-webhook`,
   listening for `checkout.session.completed` and
   `checkout.session.expired`.
5. Redeploy the relevant function (e.g.
   `supabase functions deploy create-checkout-session`) any time you
   change its code — pushing to `main`/opening a PR does not deploy it
   automatically.

## 5. Optional: Telegram "order ready" notifications

Lets a customer link a Telegram account (from checkout or My Rewards) so a
bot DMs them the moment staff mark their order ready for pickup. Two
Supabase Edge Functions handle this — `telegram-webhook` (Telegram calls
this directly whenever someone messages the bot; handles `/start <code>`
by completing the link, using the same short-lived-code handshake as the
"claim your stamps" rewards link) and `notify-telegram` (called by the
admin dashboard right after "Mark ready"; looks up the order's phone, and
if it's linked, sends the DM). Nothing in the React app needs to change
beyond what's already in this repo — `CheckoutSheet`/`LoyaltyView` already
render `TelegramLinkPrompt`, and `OrderDetailSheet`'s "Mark ready" button
already calls `markOrderReady`, which invokes `notify-telegram` itself.

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   and note the bot token it gives you and the bot's public `@username`.
2. Set the required secrets (same CLI setup as Part 4 above):
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=...
   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<a random string you make up>
   ```
3. Deploy both functions — `telegram-webhook` needs `--no-verify-jwt`
   since Telegram's requests carry no Supabase JWT (check the Supabase
   Dashboard's "Enforce JWT Verification" toggle on `stripe-webhook` first
   and mirror whatever it's actually set to today):
   ```bash
   supabase functions deploy telegram-webhook --no-verify-jwt
   supabase functions deploy notify-telegram
   ```
4. Register the webhook with Telegram, passing the same secret as
   `secret_token`:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://your-project-ref.supabase.co/functions/v1/telegram-webhook" \
     -d "secret_token=<same value as TELEGRAM_WEBHOOK_SECRET>"
   ```
5. Add the bot's public username to `.env` (safe to expose client-side —
   it's just the handle used to build the `t.me/<username>?start=<code>`
   deep link):
   ```
   VITE_TELEGRAM_BOT_USERNAME=your_bot_username
   ```
6. Restart `npm run dev` (or rebuild) so Vite picks up the new env var.

## 6. Build & deploy

```bash
npm run build
```

This outputs a static site to `dist/`. Deploy that folder to Netlify,
Vercel, or any static host — same as the original single-file version.
