import { consumeAuthToken, issueAuthToken } from "@/lib/auth/tokens";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { extractAddress, telegramCheckReply } from "./telegram-check";
import { parseMuteData, type TgButton } from "./telegram-format";

const log = logger("telegram");

async function callBot<T>(method: string, payload: unknown): Promise<T> {
  if (!env.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !body.ok) throw new Error(`Telegram: ${body.description ?? `HTTP ${res.status}`}`);
  return body.result as T;
}

/** Telegram Bot API sendMessage (legacy Markdown: callers escape untrusted text). */
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  await callBot("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true });
}

/** HTML message with optional link buttons under it (see formatTelegramAlert). Returns the message id for later edits. */
export async function sendTelegramHtml(chatId: string, text: string, buttons: TgButton[][] = [], replyTo?: number | null): Promise<number | null> {
  const msg = await callBot<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    // Still sent if the original was deleted.
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return msg?.message_id ?? null;
}

/** Replaces a sent HTML message. The buttons are passed again because an edit without reply_markup removes them. */
export async function editTelegramHtml(chatId: string, messageId: number, text: string, buttons: TgButton[][] = []): Promise<void> {
  try {
    await callBot("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  } catch (err) {
    // Same content as before: nothing to change.
    if (!errorMessage(err).includes("message is not modified")) throw err;
  }
}

let username: string | null = null;

async function botUsername(): Promise<string> {
  username ??= (await callBot<{ username: string }>("getMe", {})).username;
  return username;
}

/**
 * One-click linking: a 15-minute single-use token rides in the bot's deep link (t.me/<bot>?start=<token>).
 * When the user presses Start, the poller receives "/start <token>" and stores that chat on their profile.
 */
export async function telegramLinkUrl(userId: string): Promise<string> {
  const token = await issueAuthToken(userId, "telegram_link");
  return `https://t.me/${await botUsername()}?start=${token}`;
}

interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number; type: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number; type: string } } };
}

const MUTE_HOURS = 24;
const KIND_NAME = { coin: "this coin", dev: "this dev", wallet: "this wallet" } as const;

/** A 🔕 button under an alert: mute that coin / dev / wallet for this chat's user for 24h. */
async function handleCallback(q: NonNullable<Update["callback_query"]>) {
  const chatId = q.message?.chat.id;
  const target = q.data ? parseMuteData(q.data) : null;
  const linked = chatId ? await queryOne<{ user_id: string }>("SELECT user_id FROM profiles WHERE telegram_chat_id = $1", [String(chatId)]) : null;
  let answer = "This chat is not connected to SOLME.";
  if (linked && target) {
    await query(
      `INSERT INTO alert_mutes (user_id, kind, value, until) VALUES ($1, $2, $3, now() + make_interval(hours => $4))
       ON CONFLICT (user_id, kind, value) DO UPDATE SET until = EXCLUDED.until`,
      [linked.user_id, target.kind, target.value, MUTE_HOURS],
    );
    answer = `🔕 Muted ${KIND_NAME[target.kind]} for ${MUTE_HOURS}h. Send /mutes to see mutes, /unmute to clear them.`;
  } else if (linked) {
    answer = "Unknown button.";
  }
  await callBot("answerCallbackQuery", { callback_query_id: q.id, text: answer, show_alert: false });
}

async function listMutes(userId: string): Promise<string> {
  const rows = await query<{ kind: string; value: string; until: Date }>("SELECT kind, value, until FROM alert_mutes WHERE user_id = $1 AND until > now() ORDER BY until", [userId]);
  if (!rows.length) return "No active mutes.";
  const hours = (d: Date) => Math.max(1, Math.round((new Date(d).getTime() - Date.now()) / 3_600_000));
  return ["🔕 Active mutes:", ...rows.map((r) => `• ${r.kind} ${r.value.slice(0, 6)}…${r.value.slice(-4)} (${hours(r.until)}h left)`), "", "/unmute clears them all."].join("\n");
}

const OFFSET_KEY = "telegram_updates_offset";

async function handleMessage(chatId: string, text: string) {
  const [command, arg] = text.trim().split(/\s+/, 2);
  if (command === "/start" && arg) {
    const userId = await consumeAuthToken(arg, "telegram_link");
    if (userId) {
      const ent = await getEntitlements(userId);
      const allowed = ent.features.alert_channels.includes("telegram");
      await query("UPDATE profiles SET telegram_chat_id = $2, notify_telegram = $3, updated_at = now() WHERE user_id = $1", [userId, chatId, allowed]);
      await sendTelegram(
        chatId,
        allowed
          ? "✅ Connected to SOLME. Your alerts will arrive here. Send a contract address any time to check a coin, or /stop to pause alerts."
          : "✅ Connected to SOLME. Telegram alerts need the Pro plan; upgrade in Billing to receive them here.",
      );
      return;
    }
  }
  const linked = await queryOne<{ user_id: string }>("SELECT user_id FROM profiles WHERE telegram_chat_id = $1", [chatId]);
  if (linked && extractAddress(text)) {
    // A full check takes a few seconds: answer at once, then replace that message with the result.
    const pendingId = await sendTelegramHtml(chatId, "🔎 Checking…");
    let reply;
    try {
      reply = await telegramCheckReply(linked.user_id, text);
    } catch (err) {
      log.warn("Telegram check failed", { error: errorMessage(err) });
      reply = { text: "Something went wrong while checking this coin. Try again in a minute.", buttons: [] };
    }
    if (reply && pendingId) await editTelegramHtml(chatId, pendingId, reply.text, reply.buttons);
    else if (reply) await sendTelegramHtml(chatId, reply.text, reply.buttons);
    return;
  }
  if (command === "/mutes" && linked) {
    await sendTelegram(chatId, await listMutes(linked.user_id));
    return;
  }
  if (command === "/unmute" && linked) {
    await query("DELETE FROM alert_mutes WHERE user_id = $1", [linked.user_id]);
    await sendTelegram(chatId, "🔔 All mutes cleared.");
    return;
  }
  if (command === "/stop" && linked) {
    await query("UPDATE profiles SET notify_telegram = false, updated_at = now() WHERE telegram_chat_id = $1", [chatId]);
    await sendTelegram(chatId, "Telegram alerts paused. Turn them back on in SOLME → Account Settings.");
    return;
  }
  await sendTelegram(
    chatId,
    linked
      ? "This chat is connected to SOLME. Alerts arrive here.\n\nSend a contract address (or a pump.fun link) to check a coin: Tradeable, Watch or Avoid, with the reasons. /stop pauses alerts."
      : "To get SOLME alerts here, open SOLME → Account Settings and click Connect Telegram. The link expires after 15 minutes.",
  );
}

let polling: Promise<number> | null = null;

/** Reads new bot messages (getUpdates long-polling without a webhook, so it also works on localhost). */
export function pollTelegramUpdates(): Promise<number> {
  // One poll at a time per process: overlapping polls would handle the same /start twice.
  polling ??= (async () => {
    try {
      const row = await queryOne<{ value: number }>("SELECT value FROM app_settings WHERE key = $1", [OFFSET_KEY]);
      const updates = await callBot<Update[]>("getUpdates", { offset: row?.value ?? 0, timeout: 0, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        if (u.callback_query) {
          await handleCallback(u.callback_query).catch((err) => log.warn("Telegram button failed", { error: errorMessage(err) }));
          continue;
        }
        const m = u.message;
        if (!m?.text || m.chat.type !== "private") continue;
        await handleMessage(String(m.chat.id), m.text).catch((err) => log.warn("Telegram message failed", { error: errorMessage(err) }));
      }
      if (updates.length) {
        await query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [OFFSET_KEY, JSON.stringify(updates[updates.length - 1].update_id + 1)],
        );
      }
      return updates.length;
    } finally {
      polling = null;
    }
  })();
  return polling;
}
