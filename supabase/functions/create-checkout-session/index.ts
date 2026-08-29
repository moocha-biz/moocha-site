// supabase/functions/create-checkout-session/index.ts
//
// Called by the customer app when someone taps "Checkout". Creates a
// Stripe Checkout Session for PayNow only (Stripe generates and
// verifies the PayNow QR itself), then hands back the URL to redirect
// the customer to.
//
// Needs these secrets set once via:
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
// (see README.md, Part 5)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { orderId, name, phone, email, notes, items, amount, stallName, successUrl, cancelUrl } = body;

    if (!orderId || !amount || !successUrl || !cancelUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // deno-lint-ignore no-explicit-any
    const itemsSummary = (items || []).map((i: any) => `${i.name} x${i.qty}`).join(", ");

    const trimmedEmail = String(email || "").trim();

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["paynow"],
        line_items: [
          {
            price_data: {
              currency: "sgd",
              product_data: {
                name: `${stallName || "Moocha"} order`,
                description: itemsSummary.slice(0, 500) || undefined,
              },
              unit_amount: Math.round(Number(amount) * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          order_id: String(orderId),
          name: String(name || ""),
          phone: String(phone || ""),
          notes: String(notes || "").slice(0, 400),
          // Stripe metadata values are capped at 500 chars each — fine for a
          // typical small cart, but a very large order could get truncated.
          items: JSON.stringify(items || []).slice(0, 480),
        },
        // Prefills the email Checkout would otherwise ask for anyway, and
        // routes Stripe's auto-generated receipt to it.
        ...(trimmedEmail ? { customer_email: trimmedEmail } : {}),
        ...(trimmedEmail ? { payment_intent_data: { receipt_email: trimmedEmail } } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      // Reuses the same Checkout Session (and skips creating a duplicate
      // order downstream) if the client sends this request twice for the
      // same orderId — e.g. a double-tap on "Pay with PayNow" before the
      // button disables, or a network retry.
      { idempotencyKey: `checkout-session-${orderId}` }
    );

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
