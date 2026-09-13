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

Deno.serve(async (req) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }

  // Always return 200 past this point — Telegram retries on non-2xx, and a
  // malformed/irrelevant update (not a /start message) isn't an error on
  // our side, just nothing to do.
  try {
    const update = await req.json();
    const message = update?.message;
    const text: string | undefined = message?.text;
    const chatId = message?.chat?.id;
    const username: string | undefined = message?.from?.username;

    if (!text || !chatId || !text.startsWith("/start")) {
      return new Response("ok", { status: 200 });
    }

    const code = text.replace("/start", "").trim();
    if (!code) {
      await sendTelegramMessage(chatId, "Open the \"Connect Telegram\" link from checkout or My Rewards to link your account.");
      return new Response("ok", { status: 200 });
    }

    const { data: phone, error } = await supabase.rpc("redeem_telegram_link_code", {
      p_code: code,
      p_chat_id: chatId,
      p_username: username || null,
    });

    if (error) {
      console.error("redeem_telegram_link_code failed:", error);
      await sendTelegramMessage(chatId, "Something went wrong linking your account — please try the link again.");
      return new Response("ok", { status: 200 });
    }

    if (!phone) {
      await sendTelegramMessage(chatId, "That link has expired or was already used — grab a fresh \"Connect Telegram\" link and try again.");
      return new Response("ok", { status: 200 });
    }

    await sendTelegramMessage(chatId, "You're linked! We'll message you here the moment your order's ready. 🧋");
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("telegram-webhook error:", err);
    return new Response("ok", { status: 200 });
  }
});
