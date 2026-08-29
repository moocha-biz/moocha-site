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
// listening for the "checkout.session.completed" event.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
    let items = [];
    try { items = JSON.parse(meta.items || "[]"); } catch (_e) { items = []; }

    const { error } = await supabase.from("orders").insert({
      id: meta.order_id || session.id,
      name: meta.name || "",
      phone: meta.phone || "",
      date: new Date().toISOString(),
      items,
      total: (session.amount_total || 0) / 100,
      notes: meta.notes || "",
      status: "Received",
      stripe_session_id: session.id,
    });
    if (error) console.error("Failed to insert order from webhook:", error);

    // Bump the customer's loyalty stamp count — this is the only place
    // that happens now that PayNow-via-Stripe is the sole checkout path
    // (the old manual "Place order" flow used to do this client-side).
    if (meta.phone) {
      const { data: existing, error: selError } = await supabase
        .from("customers")
        .select("stamps")
        .eq("phone", meta.phone)
        .maybeSingle();
      if (selError) {
        console.error("Failed to look up customer for stamp bump:", selError);
      } else if (existing) {
        const { error: updError } = await supabase
          .from("customers")
          .update({ stamps: (existing.stamps || 0) + 1, name: meta.name || "", updated_at: new Date().toISOString() })
          .eq("phone", meta.phone);
        if (updError) console.error("Failed to bump customer stamp:", updError);
      } else {
        const { error: insError } = await supabase
          .from("customers")
          .insert({ phone: meta.phone, name: meta.name || "", stamps: 1 });
        if (insError) console.error("Failed to create customer stamp record:", insError);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
