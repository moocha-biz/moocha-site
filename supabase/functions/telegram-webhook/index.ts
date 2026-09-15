// supabase/functions/telegram-webhook/index.ts
//
// Telegram calls this directly (not the customer's browser) whenever
// someone messages the bot — shaped like stripe-webhook (an external
// service pushing events to us), but secured differently: Telegram has no
// per-request signature like Stripe's, just a static secret header it
// echoes back on every request once you register it via setWebhook's
// secret_token param.
//
// Needs these secrets set once via:
//   supabase secrets set TELEGRAM_BOT_TOKEN=...
//   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<random string>
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...   (NOT the anon key)
//
// Deploy with `supabase functions deploy telegram-webhook --no-verify-jwt`
// — Telegram's requests carry no Supabase JWT, so the platform's own JWT
// gate has to be turned off for this function specifically (check how
// stripe-webhook is actually configured in the Supabase Dashboard and
// mirror it — that's the established convention here for external,
// non-Supabase-client callers).
//
// Then register the webhook once:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook" \
//     -d "secret_token=<same value as TELEGRAM_WEBHOOK_SECRET>"

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTelegramMessage } from "../_shared/telegram.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Answers a customer sending /status directly instead of waiting for a
// push — looks up their linked chat, finds whichever order of theirs is
// still in flight, and reports its state the same way the push
// notifications do (reusing get_queue_position for the 'Preparing' case
// so the two never disagree).
async function replyWithOrderStatus(chatId: number) {
  const { data: customer } = await supabase
    .from("customers")
    .select("phone")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!customer?.phone) {
    await sendTelegramMessage(chatId, "You're not linked to an account yet — open the \"Connect Telegram\" link from checkout or Orders first.");
    return;
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("phone", customer.phone)
    .in("status", ["Received", "Preparing", "Ready"])
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order) {
    await sendTelegramMessage(chatId, "No order in progress right now — nothing to report.");
    return;
  }

  if (order.status === "Received") {
    await sendTelegramMessage(chatId, `Order #${order.id}: received, not started yet. Send /prepare (or tap "Start preparing my order" under Orders) when you're on your way.`);
    return;
  }
  if (order.status === "Ready") {
    await sendTelegramMessage(chatId, `Order #${order.id} is ready for pickup!`);
    return;
  }
  const { data: pos } = await supabase.rpc("get_queue_position", { p_order_id: order.id });
  const ahead = pos?.aheadDrinks ?? null;
  const aheadText = ahead == null ? "" : ahead === 0 ? " You're next!" : ` ${ahead} drink${ahead === 1 ? "" : "s"} ahead of you.`;
  await sendTelegramMessage(chatId, `Order #${order.id} is being prepared.${aheadText}`);
}

// Core of both prep-trigger paths below: calls request_order_prep for a
// specific order (using the access_token already on file for this chat's
// linked phone — the same proof of ownership the web app itself would
// have supplied) and replies with the result, including the queue
// position so the customer doesn't have to separately ask "status".
async function requestPrepForOrder(chatId: number, phone: string, accessToken: string, orderId: string) {
  const { data, error } = await supabase.rpc("request_order_prep", {
    p_id: orderId,
    p_phone: phone,
    p_token: accessToken,
  });
  if (error) {
    if (error.message === "not_open_yet") {
      await sendTelegramMessage(chatId, "We haven't opened for collection yet — check back during collection hours and send /prepare again.");
      return;
    }
    if (error.message === "collection_closed") {
      await sendTelegramMessage(chatId, "Collection hours are over for now — check with staff about this order.");
      return;
    }
    console.error("request_order_prep failed:", error);
    await sendTelegramMessage(chatId, `Couldn't request prep for order #${orderId} — please try again from Orders.`);
    return;
  }

  const ahead = data?.aheadDrinks ?? null;
  const aheadText = ahead == null ? "" : ahead === 0 ? " You're next!" : ` ${ahead} drink${ahead === 1 ? "" : "s"} ahead of you.`;
  if (!data?.changed) {
    await sendTelegramMessage(chatId, `Order #${orderId} is already being prepared.${aheadText}`);
    return;
  }
  await sendTelegramMessage(chatId, `Got it! Your order #${orderId} is being prepared now.${aheadText} You will be notified once your order is ready.`);
}

// Handles the "Start preparing my order" deep link (t.me/<bot>?start=prep_<orderId>)
// from Orders — the customer taps a button in the web app, Telegram
// opens and auto-sends this as a /start message. Requesting prep this way
// is intentionally gated on already being linked — see LoyaltyView.jsx,
// which only ever builds this link once Telegram is connected.
async function handlePrepRequest(chatId: number, orderId: string) {
  const { data: customer } = await supabase
    .from("customers")
    .select("phone, access_token")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!customer?.phone) {
    await sendTelegramMessage(chatId, "Your account isn't linked yet — open \"Connect Telegram\" from Orders first.");
    return;
  }
  await requestPrepForOrder(chatId, customer.phone, customer.access_token, orderId);
}

// Handles /prepare (and /prep) typed directly in the chat — the
// in-Telegram equivalent of tapping "Start preparing my order" under
// Orders, for a customer who'd rather manage everything from the bot than
// switch back to the web app. Finds their own latest still-Received
// preorder itself (walk-ins never go through Preparing, so those are
// excluded) rather than needing an orderId in the message.
async function handlePrepareCommand(chatId: number) {
  const { data: customer } = await supabase
    .from("customers")
    .select("phone, access_token")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!customer?.phone) {
    await sendTelegramMessage(chatId, "You're not linked to an account yet — open the \"Connect Telegram\" link from checkout or Orders first.");
    return;
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("phone", customer.phone)
    .eq("status", "Received")
    .neq("order_type", "walkin")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order) {
    await sendTelegramMessage(chatId, "No order waiting to be prepared right now.");
    return;
  }
  await requestPrepForOrder(chatId, customer.phone, customer.access_token, order.id);
}

Deno.serve(async (req) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }

  // Always return 200 past this point — Telegram retries on non-2xx, and a
  // malformed update (no text/chatId) isn't an error on our side, just
  // nothing to do.
  try {
    const update = await req.json();
    const message = update?.message;
    const text: string | undefined = message?.text;
    const chatId = message?.chat?.id;
    const username: string | undefined = message?.from?.username;

    if (!text || !chatId) {
      return new Response("ok", { status: 200 });
    }

    // Slash commands only (not bare "prepare"/"status" text) — matches how
    // Telegram bots are meant to be driven, and lines up with what you'd
    // register via BotFather/setMyCommands for the "/" command menu.
    if (/^\/(prepare|prep)\b/i.test(text.trim())) {
      await handlePrepareCommand(chatId);
      return new Response("ok", { status: 200 });
    }

    if (/^\/(status|queue|where)\b/i.test(text.trim())) {
      await replyWithOrderStatus(chatId);
      return new Response("ok", { status: 200 });
    }

    if (!text.startsWith("/start")) {
      await sendTelegramMessage(chatId, "Send /prepare to have staff start on your order, or /status to check progress/queue position — for anything else, ask staff directly.");
      return new Response("ok", { status: 200 });
    }

    const code = text.replace("/start", "").trim();
    if (!code) {
      await sendTelegramMessage(chatId, "Open the \"Connect Telegram\" link from checkout or Orders to link your account.");
      return new Response("ok", { status: 200 });
    }

    if (code.startsWith("prep_")) {
      await handlePrepRequest(chatId, code.slice("prep_".length));
      return new Response("ok", { status: 200 });
    }

    const { data: phone, error } = await supabase.rpc("redeem_telegram_link_code", {
      p_code: code,
      p_chat_id: chatId,
      p_username: username || null,
    });

    if (error) {
      if (error.message === "already_linked_elsewhere") {
        await sendTelegramMessage(chatId, "This Telegram account is already linked to a different phone number — ask staff to clear the old link first.");
        return new Response("ok", { status: 200 });
      }
      console.error("redeem_telegram_link_code failed:", error);
      await sendTelegramMessage(chatId, "Something went wrong linking your account — please try the link again.");
      return new Response("ok", { status: 200 });
    }

    if (!phone) {
      await sendTelegramMessage(chatId, "That link has expired or was already used — grab a fresh \"Connect Telegram\" link and try again.");
      return new Response("ok", { status: 200 });
    }

    await sendTelegramMessage(
      chatId,
      "You're linked! We'll DM you here the moment your order's ready.\n\n" +
      "Commands:\n" +
      "/prepare — ask staff to start on your order\n" +
      "/status — check progress or queue position\n\n" +
      "Quote your order number (or your name/phone) at the counter to collect it."
    );
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("telegram-webhook error:", err);
    return new Response("ok", { status: 200 });
  }
});
