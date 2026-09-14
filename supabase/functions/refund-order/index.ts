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

    const { orderId, amount, reason, requestId } = await req.json();
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
    // Matches refund_order()'s own status check — "Preparing" is refundable
    // too (added alongside request_order_prep), so this can't fall out of
    // sync with the DB function the way it did before.
    const REFUNDABLE_STATUSES = ["Received", "Preparing", "Ready", "Collected"];
    if (!REFUNDABLE_STATUSES.includes(order.status)) {
      return new Response(JSON.stringify({ error: `Order is "${order.status}" — nothing to refund` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A partial refund (staff typed a specific amount, e.g. one missing
    // item) vs. the default full refund of the whole order.
    const isPartial = amount != null;
    if (isPartial) {
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return new Response(JSON.stringify({ error: "Enter a valid refund amount" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (amountNum > Number(order.total)) {
        return new Response(
          JSON.stringify({ error: `Can't refund more than the order total ($${Number(order.total).toFixed(2)})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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
    // A partial refund needs a key that's unique per *attempt* rather than
    // per order — there can legitimately be several over an order's life —
    // so it folds in a client-supplied requestId (one generated per button
    // press, same pattern CheckoutSheet uses for its orderId).
    const idempotencyKey = isPartial
      ? `refund-partial-${orderId}-${requestId || crypto.randomUUID()}`
      : `refund-${orderId}`;

    let refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          ...(isPartial ? { amount: Math.round(Number(amount) * 100) } : {}),
        },
        { idempotencyKey }
      );
    } catch (stripeErr) {
      // Most commonly "this would exceed what's left on the charge" —
      // Stripe is the source of truth for that, not anything computed here.
      console.error("Stripe refund failed:", stripeErr);
      const message = stripeErr instanceof Error ? stripeErr.message : "Stripe refund failed";
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The money has now genuinely moved back on Stripe's side. If this next
    // step fails, the order/refund history is stuck out of sync with what
    // actually happened on Stripe — surface that distinctly so staff know
    // to fix the DB row by hand rather than assume the refund itself didn't
    // go through.
    //
    // Uses authedClient (the caller's own session), not the service-role
    // `supabase` client used above — both RPCs stamp refunded_by with
    // auth.email(), which only resolves to the actual staff member when
    // the RPC runs under their own JWT rather than the service role.
    // A partial refund never touches status/stamps/stock (ambiguous which
    // item it covers), unlike refund_order()'s full, order-is-void reversal.
    const { error: rpcError } = isPartial
      ? await authedClient.rpc("log_partial_refund", {
          p_id: orderId,
          p_amount: Number(amount),
          p_refund_id: refund.id,
          p_reason: reason || null,
        })
      : await authedClient.rpc("refund_order", { p_id: orderId, p_refund_id: refund.id });
    if (rpcError) {
      console.error("Stripe refund succeeded but recording it failed:", rpcError);
      return new Response(
        JSON.stringify({
          error: "Refunded on Stripe, but couldn't update the order — please tell an admin to check this order.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, refundId: refund.id, partial: isPartial }), {
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
