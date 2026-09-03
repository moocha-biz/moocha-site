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
    const body = await req.json();
    const { orderId, name, phone, email, notes, items, amount, stallName, successUrl, cancelUrl } = body;

    if (!orderId || !amount || !successUrl || !cancelUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Payment happens after this session is created, so this is the only
    // point we can actually stop an oversell — the webhook that books
    // stock only runs once Stripe confirms the money already moved.
    // deno-lint-ignore no-explicit-any
    const itemIds = (items || []).map((i: any) => i.itemId).filter(Boolean);
    if (itemIds.length > 0) {
      const { data: stockRows, error: stockError } = await supabase
        .from("items")
        .select("id, name, preorder_limit, preorder_sold")
        .in("id", itemIds);
      if (stockError) {
        console.error("Stock check failed:", stockError);
      } else {
        // deno-lint-ignore no-explicit-any
        for (const line of items as any[]) {
          const row = stockRows?.find((r) => r.id === line.itemId);
          if (!row || row.preorder_limit == null) continue;
          const remaining = row.preorder_limit - row.preorder_sold;
          if (Number(line.qty) > remaining) {
            // 200 (not an HTTP error status) so the client SDK hands this
            // straight back as `data` instead of wrapping it in a
            // FunctionsHttpError that needs unwrapping to read the message.
            return new Response(
              JSON.stringify({ error: `Sorry, only ${Math.max(remaining, 0)} of "${row.name}" left for preorder.` }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
    }

    const trimmedEmail = String(email || "").trim();

    // One Stripe line item per cart item, so the item names/quantities show
    // up on Stripe's auto-generated receipt email — a single bundled
    // "<stall> order" line only ever showed a generic name there, since
    // Stripe's receipt doesn't render the line item's `description` field.
    // deno-lint-ignore no-explicit-any
    const lineItems = (items || [])
      .filter((i: any) => i && i.name && Number(i.qty) > 0)
      .map((i: any) => ({
        price_data: {
          currency: "sgd",
          product_data: { name: String(i.name).slice(0, 250) },
          unit_amount: Math.round((Number(i.lineTotal) / Number(i.qty)) * 100),
        },
        quantity: Number(i.qty),
      }));

    if (lineItems.length === 0) {
      lineItems.push({
        price_data: {
          currency: "sgd",
          product_data: { name: `${stallName || "Moocha"} order` },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      });
    }

    // `customer_email` only sets the email on the Customer record created
    // *after* payment — it doesn't prefill the visible email field on the
    // hosted Checkout page, so customers were being asked to type it again.
    // An actual Customer with an email already set does prefill (and lock)
    // that field, per Stripe's docs.
    let customerId: string | undefined;
    if (trimmedEmail) {
      const customer = await stripe.customers.create(
        { email: trimmedEmail, name: String(name || "").slice(0, 250) },
        { idempotencyKey: `customer-${orderId}` }
      );
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["paynow"],
        line_items: lineItems,
        metadata: {
          order_id: String(orderId),
          name: String(name || ""),
          phone: String(phone || ""),
          notes: String(notes || "").slice(0, 400),
          // Stripe metadata values are capped at 500 chars each — fine for a
          // typical small cart, but a very large order could get truncated.
          items: JSON.stringify(items || []).slice(0, 480),
        },
        ...(customerId ? { customer: customerId } : {}),
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
