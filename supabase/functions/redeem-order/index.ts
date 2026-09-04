// supabase/functions/redeem-order/index.ts
//
// Places a preorder that's entirely covered by a customer's loyalty reward
// (cart total $0 after redeeming 1 free unit) — Stripe Checkout can't
// process a $0 total at all, so this bypasses Stripe and writes the order
// directly, the same way log_walkin_order does for a walk-in's redemption.
// A redemption alongside other paid items instead goes through the normal
// create-checkout-session/Stripe flow, which handles the discount as a $0
// Stripe line item within a still-positive total.
//
// Needs the same secrets as create-checkout-session/stripe-webhook (see
// README.md, Part 4).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { ordersAreOpen } from "../_shared/ordersOpen.ts";

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
    const { orderId, name, phone, customerToken, notes, items } = body;

    const trimmedPhone = String(phone || "").trim();
    // deno-lint-ignore no-explicit-any
    const cartLines = (items || []) as any[];
    if (!orderId || !trimmedPhone || !customerToken || cartLines.length === 0) {
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

    const redeemedLines = cartLines.filter((l) => l.redeemed === true);
    if (redeemedLines.length !== 1) {
      return new Response(JSON.stringify({ error: "Exactly one item must be marked as your free drink" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Never trust the client's word that this phone is eligible — re-check
    // against the database, the same way create-checkout-session does.
    // This is just a friendly early check to skip the stock lookup below
    // for an obviously-ineligible request; place_redeemed_order() re-checks
    // (and actually deducts) under a row lock, so it's what really decides
    // eligibility.
    const { data: rewardRow } = await supabase
      .from("customers")
      .select("stamps")
      .eq("phone", trimmedPhone)
      .eq("access_token", customerToken)
      .maybeSingle();
    if (!rewardRow || (rewardRow.stamps || 0) < STAMP_GOAL) {
      return new Response(JSON.stringify({ error: "You don't have enough stamps for a free drink yet" }), {
        status: 200,
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

    // Price and stock both come from the database, never the client, same
    // as create-checkout-session.
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
      if (row.preorder_limit != null) {
        const remaining = row.preorder_limit - row.preorder_sold;
        if (qty > remaining) {
          return new Response(
            JSON.stringify({ error: `Sorry, only ${Math.max(remaining, 0)} of "${row.name}" left for preorder.` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      const isRedeemedLine = line.redeemed === true;
      const paidQty = isRedeemedLine ? qty - 1 : qty;
      metaItems.push({
        itemId: row.id, name: row.name, sugar: line.sugar, qty, lineTotal: Number(row.price) * paidQty,
        ...(isRedeemedLine ? { redeemed: true } : {}),
      });
    }

    const total = metaItems.reduce((s, it) => s + it.lineTotal, 0);
    // The whole point of this endpoint is a $0 order — anything else means
    // the frontend picked the wrong endpoint (this cart should have gone
    // through create-checkout-session/Stripe instead), so refuse rather
    // than quietly give away paid items for free.
    if (total !== 0) {
      return new Response(
        JSON.stringify({ error: "This order isn't fully covered by your reward — checking out again should fix it" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Order insert, stamp deduction, and stock booking all happen inside
    // one atomic, row-locked function — not three separate client calls —
    // so the 8 stamps actually come off the moment the order is placed
    // (not only once staff mark it collected), and a concurrent redemption
    // attempt for the same phone can't both pass the eligibility check
    // before either one deducts. orders.id being the primary key still
    // makes a retried request for the same orderId (double-tap, network
    // hiccup) idempotent — place_redeemed_order hands back the existing
    // order instead of erroring or double-deducting for it.
    const { data: placed, error: placeError } = await supabase.rpc("place_redeemed_order", {
      p_id: orderId,
      p_name: String(name || ""),
      p_phone: trimmedPhone,
      p_token: customerToken,
      p_items: metaItems,
      p_notes: String(notes || "").slice(0, 400),
    });

    if (placeError) {
      if (placeError.message?.includes("not_eligible")) {
        return new Response(JSON.stringify({ error: "You don't have enough stamps for a free drink yet" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Failed to place redeemed order:", placeError);
      return new Response(JSON.stringify({ error: "Couldn't place your order, please try again" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, order: placed }),
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
