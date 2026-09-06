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
import { ordersAreOpen } from "../_shared/ordersOpen.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Keep in sync with STAMP_GOAL in src/data/defaults.js.
const STAMP_GOAL = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { orderId, name, phone, email, notes, items, successUrl, cancelUrl, customerToken } = body;

    // deno-lint-ignore no-explicit-any
    const cartLines = (items || []) as any[];
    if (!orderId || !successUrl || !cancelUrl || cartLines.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The client only disables the Checkout button for this — nothing
    // stopped a direct call here from placing an order while paused or
    // past the scheduled cutoff, so it's re-checked for real.
    if (!(await ordersAreOpen(supabase))) {
      return new Response(JSON.stringify({ error: "Orders are closed right now — check back soon." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Every STAMP_GOAL-th drink is free — counting whatever's already
    // banked on this phone (only trusted once its token is verified against
    // the database, same as before) plus every drink in this very cart, the
    // same "buy 7, the 8th's on us" rule a physical stamp card enforces.
    // Never trusted from the request: recomputed here from scratch and
    // handed the cheapest unit(s) first, ignoring whatever the client
    // itself claimed was redeemed.
    const trimmedPhone = String(phone || "").trim();
    let verifiedStamps = 0;
    if (trimmedPhone && customerToken) {
      const { data: rewardRow } = await supabase
        .from("customers")
        .select("stamps")
        .eq("phone", trimmedPhone)
        .eq("access_token", customerToken)
        .maybeSingle();
      verifiedStamps = rewardRow?.stamps || 0;
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

    // Validate every line and check stock before touching stamps or Stripe —
    // an oversell or missing item should fail the same way it always did,
    // independent of anything about redemption.
    // deno-lint-ignore no-explicit-any
    const validLines: { line: any; row: any; qty: number }[] = [];
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
      validLines.push({ line, row, qty });
    }

    const cartQtyTotal = validLines.reduce((s, v) => s + v.qty, 0);
    let freeUnitsRemaining = Math.min(
      Math.floor((verifiedStamps + cartQtyTotal) / STAMP_GOAL),
      cartQtyTotal
    );
    // Cheapest unit(s) first, never left to the client to pick — sorting a
    // copy so validLines itself stays in the customer's original cart order
    // for the Stripe line items below.
    // deno-lint-ignore no-explicit-any
    const freeQtyByLine = new Map<any, number>();
    const byPriceAsc = [...validLines].sort((a, b) => Number(a.row.price) - Number(b.row.price));
    for (const v of byPriceAsc) {
      if (freeUnitsRemaining <= 0) break;
      const take = Math.min(v.qty, freeUnitsRemaining);
      freeQtyByLine.set(v.line, take);
      freeUnitsRemaining -= take;
    }

    // deno-lint-ignore no-explicit-any
    const metaItems: any[] = [];
    // One Stripe line item per cart item, so the item names/quantities show
    // up on Stripe's auto-generated receipt email — a single bundled
    // "<stall> order" line only ever showed a generic name there, since
    // Stripe's receipt doesn't render the line item's `description` field.
    // deno-lint-ignore no-explicit-any
    const lineItems: any[] = [];
    for (const { line, row, qty } of validLines) {
      const unitAmount = Math.round(Number(row.price) * 100);
      const freeQty = freeQtyByLine.get(line) || 0;
      // Free unit(s) get split into their own $0 line so the Stripe receipt
      // still itemizes the drink instead of hiding it, alongside a normal
      // full-price line for whatever's left of that line's quantity
      // (omitted entirely once freeQty covers the whole line).
      const paidQty = qty - freeQty;
      if (paidQty > 0) {
        lineItems.push({
          price_data: { currency: "sgd", product_data: { name: String(row.name).slice(0, 250) }, unit_amount: unitAmount },
          quantity: paidQty,
        });
      }
      if (freeQty > 0) {
        lineItems.push({
          price_data: { currency: "sgd", product_data: { name: `${String(row.name).slice(0, 230)} (reward)` }, unit_amount: 0 },
          quantity: freeQty,
        });
      }
      metaItems.push({
        itemId: row.id, name: row.name, sugar: line.sugar, qty, lineTotal: (unitAmount * paidQty) / 100,
        ...(freeQty > 0 ? { redeemed: true, freeQty } : {}),
      });
    }

    // A fully-redeemed cart (nothing paid at all) can't be charged through
    // Stripe Checkout, which requires a total greater than zero — the
    // frontend is expected to route that case to redeem-order instead, so
    // landing here means something upstream didn't branch correctly.
    if (lineItems.length > 0 && lineItems.every((li) => li.price_data.unit_amount === 0)) {
      return new Response(
        JSON.stringify({ error: "This order is fully covered by your reward — try checking out again" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
