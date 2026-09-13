// supabase/functions/notify-telegram/index.ts
//
// Called by the admin dashboard right after an order is marked ready.
// Staff-authenticated via the request's bearer token (same pattern as
// refund-order/get-order-payment), service-role client for the actual DB
// read. Re-derives phone/status from the orders table itself — never
// trusts a client-sent phone.
//
// The order's Ready status is already committed regardless of whether the
// DM succeeds, so this only ever returns 200 — "skipped" for the expected,
// common, non-error cases (not Ready, no phone, not linked), never a 500
// that would make the caller think the status change itself failed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";

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
      .select("id, status, phone")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.status !== "Ready") {
      return new Response(JSON.stringify({ skipped: true, reason: "not Ready" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!order.phone) {
      return new Response(JSON.stringify({ skipped: true, reason: "no phone" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("telegram_chat_id")
      .eq("phone", order.phone)
      .maybeSingle();
    if (!customer?.telegram_chat_id) {
      return new Response(JSON.stringify({ skipped: true, reason: "not linked" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await sendTelegramMessage(customer.telegram_chat_id, `🧋 Your order #${order.id} is ready for pickup!`);

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
