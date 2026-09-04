// supabase/functions/get-order-payment/index.ts
//
// Called by the admin dashboard's order detail view to show the full
// Stripe picture for a paid order — payment status, method, receipt link,
// and any dispute — without staff having to leave the app and dig through
// the Stripe Dashboard by hand. Read-only: it never mutates anything on
// Stripe or in the database, but it's still real financial detail, so it
// gates on a real staff session exactly like refund-order does (the
// platform's JWT check alone would also pass for the public anon key).
//
// Needs the same secrets as create-checkout-session/stripe-webhook/
// refund-order (see README.md, Part 4) plus SUPABASE_ANON_KEY, which
// Supabase injects into every edge function automatically.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const authedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await authedClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Staff sign-in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "Missing orderId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, stripe_session_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!order.stripe_session_id) {
      return new Response(JSON.stringify({ error: "This order has no Stripe payment" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id, {
      expand: ["payment_intent.latest_charge", "payment_intent.latest_charge.balance_transaction"],
    });

    // deno-lint-ignore no-explicit-any
    const paymentIntent = session.payment_intent as any;
    const charge = paymentIntent?.latest_charge;
    const balanceTx = charge?.balance_transaction;

    return new Response(
      JSON.stringify({
        livemode: session.livemode,
        sessionId: session.id,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        currency: session.currency,
        created: session.created,
        customerEmail: session.customer_details?.email || null,
        paymentIntentId: typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id || null,
        chargeId: charge?.id || null,
        paymentMethodType: charge?.payment_method_details?.type || null,
        paynowReference: charge?.payment_method_details?.paynow?.reference || null,
        receiptUrl: charge?.receipt_url || null,
        refunded: charge?.refunded || false,
        amountRefunded: charge?.amount_refunded ?? null,
        disputed: charge?.disputed || false,
        feeAmount: balanceTx?.fee ?? null,
        netAmount: balanceTx?.net ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
