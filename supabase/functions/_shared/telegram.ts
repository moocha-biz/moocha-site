// Thin wrapper around Telegram's Bot API sendMessage call, shared by
// telegram-webhook (confirmation/error replies) and notify-telegram
// (the actual "order ready" DM).

export async function sendTelegramMessage(chatId: number | string, text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN not set — cannot send Telegram message");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Telegram sendMessage threw:", err);
  }
}
