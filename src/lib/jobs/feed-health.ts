import { sendTelegram } from "@/lib/alerts/telegram";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { launchpadStreamStatus } from "@/lib/launchpad/stream";
import { errorMessage, logger } from "@/lib/log";
import { walletStreamStatus } from "@/lib/wallets/live";

const log = logger("feed-health");

/** pump.fun alone launches several coins a minute: 3 silent minutes means the feed is down, not quiet. */
export const LAUNCH_SILENT_MS = 3 * 60_000;
export const WALLETS_DOWN_MS = 5 * 60_000;

export interface FeedState {
  feed: "launchpad" | "wallets";
  ok: boolean;
  detail: string;
}

const FEED_NAME = { launchpad: "Launch feed (PumpPortal)", wallets: "Smart-wallet live feed (Helius)" } as const;
const IMPACT = {
  launchpad: "New launches, proven-dev alerts and dev scores miss whatever launches in the gap.",
  wallets: "Smart-wallet buys fall back to ~90s polling until it reconnects.",
} as const;

/** Health of the live feeds running in this process (the worker). Feeds not running here are left out. */
export function feedStatus(now = Date.now()): FeedState[] {
  const out: FeedState[] = [];
  const lp = launchpadStreamStatus();
  if (lp.running) {
    const silent = now - lp.lastMessageAt;
    out.push({ feed: "launchpad", ok: silent <= LAUNCH_SILENT_MS, detail: `last message ${Math.round(silent / 1000)}s ago` });
  }
  const w = walletStreamStatus();
  if (w.running) {
    const down = w.downSince ? now - w.downSince : 0;
    out.push({ feed: "wallets", ok: w.connected || down <= WALLETS_DOWN_MS, detail: w.connected ? `${w.wallets} addresses live` : `disconnected ${Math.round(down / 1000)}s` });
  }
  return out;
}

async function notifyAdmins(text: string) {
  if (!env.telegramBotToken) return;
  const chats = await query<{ chat: string }>(
    "SELECT p.telegram_chat_id AS chat FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.role_id = 3 AND u.status = 'active' AND p.telegram_chat_id IS NOT NULL",
  );
  for (const { chat } of chats) await sendTelegram(chat, text).catch((err) => log.warn("Admin feed alert failed", { error: errorMessage(err) }));
}

const fmtGap = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/**
 * Every minute in the worker: publishes feed status (read by /api/health from any process) and tells admins on Telegram
 * when a feed goes down and when it comes back, with the length of the gap. Gaps are kept for the record.
 */
export async function checkFeeds(now = Date.now(), states = feedStatus(now)): Promise<FeedState[]> {
  const row = await queryOne<{ value: { incidents?: Record<string, number>; gaps?: { feed: string; from: string; to: string }[] } }>(
    "SELECT value FROM app_settings WHERE key = 'feed_health'",
  );
  const incidents = { ...(row?.value.incidents ?? {}) };
  const gaps = [...(row?.value.gaps ?? [])];
  for (const s of states) {
    const open = incidents[s.feed];
    if (!s.ok && !open) {
      incidents[s.feed] = now;
      log.warn("Feed down", { feed: s.feed, detail: s.detail });
      await notifyAdmins(`⚠️ ${FEED_NAME[s.feed]} is down (${s.detail}). ${IMPACT[s.feed]} Reconnecting automatically.`);
    } else if (s.ok && open) {
      delete incidents[s.feed];
      gaps.unshift({ feed: s.feed, from: new Date(open).toISOString(), to: new Date(now).toISOString() });
      log.info("Feed recovered", { feed: s.feed, gapMs: now - open });
      await notifyAdmins(`✅ ${FEED_NAME[s.feed]} is back after ${fmtGap(now - open)}.`);
    }
  }
  const value = { incidents, gaps: gaps.slice(0, 20), states, checkedAt: new Date(now).toISOString() };
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('feed_health', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(value)],
  );
  return states;
}
