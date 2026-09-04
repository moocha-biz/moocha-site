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

    const redeemedLines = cartLines.filter((l) => l.redeemed === true);
    if (redeemedLines.length !== 1) {
      return new Response(JSON.stringify({ error: "Exactly one item must be marked as your free drink" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Never trust the client's word that this phone is eligible — re-check
    // against the database, the same way create-checkout-session does.
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

    const { error: insertError } = await supabase.from("orders").insert({
      id: orderId,
      name: String(name || ""),
      phone: trimmedPhone,
      date: new Date().toISOString(),
      items: metaItems,
      total: 0,
      notes: String(notes || "").slice(0, 400),
      status: "Received",
      order_type: "preorder",
    });

    if (insertError) {
      // orders.id is the primary key — a retried request for the same
      // orderId (double-tap, network hiccup) lands here as a conflict, so
      // hand back the order that's already there instead of erroring or
      // double-booking stock for it.
      if (insertError.code === "23505") {
        const { data: existing } = await supabase
          .from("orders").select("id, items, total, status").eq("id", orderId).maybeSingle();
        if (existing) {
          return new Response(JSON.stringify({ success: true, order: existing }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      console.error("Failed to write redeemed order:", insertError);
      return new Response(JSON.stringify({ error: "Couldn't place your order, please try again" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: stockBookError } = await supabase.rpc("record_preorder_sale", { p_items: metaItems });
    if (stockBookError) console.error("Failed to record preorder stock for redeemed order:", stockBookError);

    return new Response(
      JSON.stringify({ success: true, order: { id: orderId, items: metaItems, total: 0, status: "Received" } }),
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
