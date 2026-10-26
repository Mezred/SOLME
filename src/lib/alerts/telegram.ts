import { env } from "@/lib/env";

/** Telegram Bot API sendMessage. Users link a chat by messaging the bot and entering their chat ID in settings. */
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  if (!env.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !body.ok) throw new Error(`Telegram: ${body.description ?? `HTTP ${res.status}`}`);
}
