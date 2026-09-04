// supabase/functions/stripe-webhook/index.ts
//
// Stripe calls this directly (not the customer's browser) the moment a
// payment actually completes. This is what makes payment confirmation
// real instead of an honor system — the order only gets written to the
// database here, after Stripe itself confirms the money moved.
//
// Needs these secrets set once via:
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...   (NOT the anon key —
//       this is the other, more powerful key from Project Settings > API.
//       It must only ever live here, never in index.html or any client code.)
//
// Then in the Stripe Dashboard, add a webhook endpoint pointing to:
//   https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook
// listening for these events:
//   - checkout.session.completed  (payment succeeded)
//   - checkout.session.expired    (PayNow QR timed out / was abandoned)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// deno-lint-ignore no-explicit-any
function parseItems(raw: string | undefined): any[] {
  try {
    return JSON.parse(raw || "[]");
  } catch (_e) {
    return [];
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("Webhook signature check failed:", err);
    return new Response(`Webhook signature error: ${err}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    // deno-lint-ignore no-explicit-any
    const session = event.data.object as any;
    const meta = session.metadata || {};
    const items = parseItems(meta.items);

    const { error } = await supabase.from("orders").insert({
      id: meta.order_id || session.id,
      name: meta.name || "",
      phone: meta.phone || "",
      date: new Date().toISOString(),
      items,
      total: (session.amount_total || 0) / 100,
      notes: meta.notes || "",
      status: "Received",
      order_type: "preorder",
      stripe_session_id: session.id,
    });

    if (error) {
      // Stripe explicitly can redeliver the same event more than once.
      // orders.id is the primary key, so a redelivery lands here as a
      // conflict (already inserted) rather than a duplicate row — and
      // critically, we must NOT re-run the stock booking below for it,
      // or the same paid order would get double-counted against stock.
      console.error("Order insert skipped (likely a duplicate webhook delivery):", error);
    } else {
      // Books this order's items against each item's preorder stock
      // counter. Only reached on a genuine first-time insert. The loyalty
      // stamp is no longer given here — it's only awarded when staff mark
      // the order collected (mark_order_collected), since a paid preorder
      // isn't picked up yet at this point.
      const { error: stockError } = await supabase.rpc("record_preorder_sale", { p_items: items });
      if (stockError) console.error("Failed to record preorder stock:", stockError);

      // Mint (once) the per-customer secret that get_my_stamps/get_my_orders
      // require alongside a phone number — a phone number alone is
      // brute-forceable, so without this any 8-digit SG mobile number could
      // be used to read someone else's order history. This only ever runs
      // for a genuinely paid order, and the token is only ever handed back
      // once, inside this order's own receipt (get_order_receipt).
      const phone = meta.phone || "";
      if (phone) {
        const { data: existing } = await supabase
          .from("customers")
          .select("access_token")
          .eq("phone", phone)
          .maybeSingle();
        if (!existing) {
          await supabase.from("customers").insert({
            phone, name: meta.name || "", stamps: 0, access_token: crypto.randomUUID(),
          });
        } else if (!existing.access_token) {
          await supabase.from("customers").update({ access_token: crypto.randomUUID() }).eq("phone", phone);
        }
      }
    }
  } else if (event.type === "checkout.session.expired") {
    // The PayNow QR timed out (or the customer closed the tab) before
    // paying. Nothing was ever written for this order, so record it as a
    // failed attempt — the admin dashboard can then show it instead of it
    // vanishing silently, and staff can follow up if needed.
    // deno-lint-ignore no-explicit-any
    const session = event.data.object as any;
    const meta = session.metadata || {};
    if (meta.order_id) {
      const { error } = await supabase.from("orders").insert({
        id: meta.order_id,
        name: meta.name || "",
        phone: meta.phone || "",
        date: new Date().toISOString(),
        items: parseItems(meta.items),
        total: (session.amount_total || 0) / 100,
        notes: meta.notes || "",
        status: "Payment failed",
        stripe_session_id: session.id,
      });
      if (error) console.error("Failed to record expired checkout session:", error);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
