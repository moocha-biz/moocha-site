// supabase/functions/refund-order/index.ts
//
// Called by the admin dashboard to refund a Stripe-paid (PayNow) order.
// Cash/walk-in refunds skip this entirely and call the refund_order() DB
// function directly, since there's no Stripe payment to reverse for them.
//
// This is the one place a full Stripe refund is actually issued, so it
// re-checks staff auth itself rather than trusting the platform's JWT gate
// (that gate only proves the caller holds *a* valid project JWT — the
// public anon key satisfies it too — not that they're a signed-in staff
// member). Needs the same secrets as create-checkout-session/stripe-webhook
// (see README.md, Part 5) plus SUPABASE_ANON_KEY, which Supabase injects
// into every edge function automatically.

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
    // A real signed-in staff session, not just "holds the anon key" — the
    // anon key alone would also pass Supabase's platform-level JWT check.
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
      .select("id, status, stripe_session_id, total")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!order.stripe_session_id) {
      return new Response(JSON.stringify({ error: "This order has no Stripe payment to refund" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.status !== "Received" && order.status !== "Collected") {
      return new Response(JSON.stringify({ error: `Order is "${order.status}" — nothing to refund` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: "Couldn't find the original payment on Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency key means a retried request (double-tap, network hiccup)
    // reuses the same refund on Stripe's side instead of refunding twice.
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund-${orderId}` }
    );

    // The money has now genuinely moved back on Stripe's side. If this next
    // step fails, the order is stuck showing "Received"/"Collected" despite
    // being refunded — surface that distinctly so staff know to fix the DB
    // row by hand rather than assume the refund itself didn't go through.
    const { error: rpcError } = await supabase.rpc("refund_order", {
      p_id: orderId,
      p_refund_id: refund.id,
    });
    if (rpcError) {
      console.error("Stripe refund succeeded but refund_order() failed:", rpcError);
      return new Response(
        JSON.stringify({
          error: "Refunded on Stripe, but couldn't update the order — please tell an admin to check this order.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, refundId: refund.id }), {
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
