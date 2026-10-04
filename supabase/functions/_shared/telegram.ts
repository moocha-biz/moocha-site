// Thin wrapper around Telegram's Bot API sendMessage call, shared by
// telegram-webhook (confirmation/error replies) and notify-telegram
// (the actual "order ready" DM). Never throws — resolves to whether
// Telegram actually accepted the message, so callers that need to know
// (notify-telegram releasing its claim) can check.

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN not set — cannot send Telegram message");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram sendMessage threw:", err);
    return false;
  }
}
