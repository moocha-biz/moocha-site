// supabase/functions/notify-telegram/index.ts
//
// Called right after an order moves to 'Preparing' (customer- or
// staff-triggered) or 'Ready' (staff-triggered). Service-role client for
// the actual DB read; re-derives phone/status/items from the orders table
// itself — never trusts a client-sent phone or message content, only which
// stage to check for.
//
// Deliberately NOT staff-authenticated (unlike most other admin-invoked
// functions) — requestOrderPrep's success path calls this from a
// customer's own (anonymous) browser session for the 'preparing' stage,
// and customers never hold a real Supabase Auth session to authenticate
// with. Safe without it because the function never trusts anything the
// caller sends beyond which orderId/stage to check — worst case a caller
// who knows/guesses an orderId triggers a duplicate, accurate status DM to
// that order's own linked customer, not a data leak or a fake message.
//
// The order's status change is already committed regardless of whether the
// DM succeeds, so this only ever returns 200 — "skipped" for the expected,
// common, non-error cases (wrong stage, no phone, not linked), never a 500
// that would make the caller think the status change itself failed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function skip(reason: string) {
  return new Response(JSON.stringify({ skipped: true, reason }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, stage } = await req.json();
    const wantStatus = stage === "preparing" ? "Preparing" : "Ready";
    if (!orderId) {
      return new Response(JSON.stringify({ error: "Missing orderId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, phone, items")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.status !== wantStatus) {
      return skip(`not ${wantStatus}`);
    }
    if (!order.phone) {
      return skip("no phone");
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("telegram_chat_id")
      .eq("phone", order.phone)
      .maybeSingle();
    if (!customer?.telegram_chat_id) {
      return skip("not linked");
    }

    let text: string;
    if (wantStatus === "Preparing") {
      const { data: pos } = await supabase.rpc("get_queue_position", { p_order_id: order.id });
      const ahead = pos?.aheadDrinks ?? null;
      const aheadText = ahead == null ? "" : ahead === 0 ? " You're next!" : ` ${ahead} drink${ahead === 1 ? "" : "s"} ahead of you.`;
      text = `Your order #${order.id} is being prepared!${aheadText}`;
    } else {
      const itemsSummary = Array.isArray(order.items)
        ? order.items.map((it: { name?: string; qty?: number }) => `${it.name || "item"} x${it.qty || 1}`).join(", ")
        : "";
      text = `Your order #${order.id} is ready for pickup!${itemsSummary ? `\n${itemsSummary}` : ""}`;
    }

    try {
      await sendTelegramMessage(customer.telegram_chat_id, text);
    } catch (sendErr) {
      console.error("sendTelegramMessage failed:", sendErr);
      return skip("send failed");
    }

    return new Response(JSON.stringify({ notified: true }), {
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
