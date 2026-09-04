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
    const { orderId, name, phone, email, notes, items, successUrl, cancelUrl } = body;

    // deno-lint-ignore no-explicit-any
    const cartLines = (items || []) as any[];
    if (!orderId || !successUrl || !cancelUrl || cartLines.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itemIds = cartLines.map((i) => i.itemId).filter(Boolean);
    if (itemIds.length !== cartLines.length) {
      return new Response(JSON.stringify({ error: "Cart contains an invalid item" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Price and stock must both come from the database, never from the
    // client — the client only supplies which items and how many, so a
    // tampered lineTotal/amount can't change what actually gets charged.
    const { data: stockRows, error: stockError } = await supabase
      .from("items")
      .select("id, name, price, preorder_limit, preorder_sold")
      .in("id", itemIds);
    if (stockError) {
      console.error("Stock check failed:", stockError);
      return new Response(JSON.stringify({ error: "Couldn't verify cart, please try again" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rowsById = new Map((stockRows || []).map((r) => [r.id, r]));
    // deno-lint-ignore no-explicit-any
    const metaItems: any[] = [];
    // One Stripe line item per cart item, so the item names/quantities show
    // up on Stripe's auto-generated receipt email — a single bundled
    // "<stall> order" line only ever showed a generic name there, since
    // Stripe's receipt doesn't render the line item's `description` field.
    // deno-lint-ignore no-explicit-any
    const lineItems: any[] = [];
    for (const line of cartLines) {
      const row = rowsById.get(line.itemId);
      if (!row) {
        return new Response(JSON.stringify({ error: "One of the items in your cart is no longer available" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        return new Response(JSON.stringify({ error: "Invalid quantity in cart" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Payment happens after this session is created, so this is the only
      // point we can actually stop an oversell — the webhook that books
      // stock only runs once Stripe confirms the money already moved.
      if (row.preorder_limit != null) {
        const remaining = row.preorder_limit - row.preorder_sold;
        if (qty > remaining) {
          // 200 (not an HTTP error status) so the client SDK hands this
          // straight back as `data` instead of wrapping it in a
          // FunctionsHttpError that needs unwrapping to read the message.
          return new Response(
            JSON.stringify({ error: `Sorry, only ${Math.max(remaining, 0)} of "${row.name}" left for preorder.` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      const unitAmount = Math.round(Number(row.price) * 100);
      lineItems.push({
        price_data: {
          currency: "sgd",
          product_data: { name: String(row.name).slice(0, 250) },
          unit_amount: unitAmount,
        },
        quantity: qty,
      });
      metaItems.push({ itemId: row.id, name: row.name, sugar: line.sugar, qty, lineTotal: (unitAmount * qty) / 100 });
    }

    const trimmedEmail = String(email || "").trim();

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
          // Built from metaItems (server-verified name/price), not the raw
          // client payload, so the order record can't be forged either.
          items: JSON.stringify(metaItems).slice(0, 480),
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
