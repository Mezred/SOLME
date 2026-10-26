import { query, queryOne, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { errorMessage, logger } from "@/lib/log";
import { getEntitlements } from "@/lib/billing/entitlements";
import { sendTelegram } from "./telegram";

const log = logger("alerts");

interface Rule {
  id: string;
  user_id: string;
  name: string;
  rule_type: string;
  chain: string | null;
  token_id: string | null;
  wallet_id: string | null;
  params: Record<string, unknown>;
  channels: string[];
  cooldown_minutes: number;
  last_triggered_at: Date | null;
  created_at: Date;
}

interface Snap {
  id: number;
  price_usd: number | null;
  price_change_m5: number | null;
  price_change_h1: number | null;
  price_change_h24: number | null;
  volume_h1: number | null;
  volume_h24: number | null;
  liquidity_usd: number | null;
  captured_at: Date;
}

interface Trigger {
  dedupKey: string;
  title: string;
  body: string;
  link: string | null;
  payload: Record<string, unknown>;
}

const fmt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toPrecision(4));
const LEVELS = ["low", "medium", "high", "critical"];

async function tokenLabel(tokenId: string) {
  return (await queryOne<{ symbol: string; chain: string }>("SELECT symbol, chain FROM token_assets WHERE id = $1", [tokenId])) ?? { symbol: "?", chain: "?" };
}

async function evaluateRule(rule: Rule): Promise<Trigger[]> {
  const p = rule.params;
  const since = rule.last_triggered_at ?? rule.created_at;

  if (rule.token_id && ["price_above", "price_below", "price_change", "volume_spike", "liquidity_drop"].includes(rule.rule_type)) {
    const snaps = await query<Snap>(
      `SELECT id, price_usd, price_change_m5, price_change_h1, price_change_h24, volume_h1, volume_h24, liquidity_usd, captured_at
         FROM market_snapshots WHERE token_id = $1 ORDER BY captured_at DESC LIMIT 2`,
      [rule.token_id],
    );
    const [cur, prev] = snaps;
    if (!cur || cur.price_usd === null) return [];
    if (Date.now() - new Date(cur.captured_at).getTime() > 30 * 60_000) return []; // never alert on stale data
    const t = await tokenLabel(rule.token_id);
    const link = `/app/token/${t.chain}/${rule.token_id}`;

    if (rule.rule_type === "price_above" || rule.rule_type === "price_below") {
      const level = Number(p.price);
      const above = rule.rule_type === "price_above";
      // Fire on the crossing only: previous snapshot on the other side of the level.
      if (!prev || prev.price_usd === null) return [];
      const crossed = above ? prev.price_usd < level && cur.price_usd >= level : prev.price_usd > level && cur.price_usd <= level;
      if (!crossed) return [];
      return [{ dedupKey: `snap:${cur.id}`, link, title: `${t.symbol} crossed ${above ? "above" : "below"} $${fmt(level)}`, body: `${t.symbol} is now $${fmt(cur.price_usd)}.`, payload: { price: cur.price_usd, level } }];
    }
    if (rule.rule_type === "price_change") {
      const win = String(p.window) as "m5" | "h1" | "h24";
      const ch = cur[`price_change_${win}` as const];
      if (ch === null) return [];
      const pct = Number(p.pct);
      const dir = String(p.direction);
      const hit = dir === "up" ? ch >= pct : dir === "down" ? ch <= -pct : Math.abs(ch) >= pct;
      if (!hit) return [];
      return [{ dedupKey: `chg:${win}:${Math.floor(Date.now() / (rule.cooldown_minutes * 60_000))}`, link, title: `${t.symbol} ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}% (${win})`, body: `${t.symbol} moved ${ch.toFixed(1)}% over ${win}; price $${fmt(cur.price_usd)}.`, payload: { change: ch, window: win } }];
    }
    if (rule.rule_type === "volume_spike") {
      if (!cur.volume_h1 || !cur.volume_h24) return [];
      const ratio = cur.volume_h1 / (cur.volume_h24 / 24);
      if (ratio < Number(p.multiple)) return [];
      return [{ dedupKey: `vol:${Math.floor(Date.now() / (rule.cooldown_minutes * 60_000))}`, link, title: `${t.symbol} volume spike ${ratio.toFixed(1)}×`, body: `Last-hour volume is ${ratio.toFixed(1)}× the 24h hourly average.`, payload: { ratio } }];
    }
    if (rule.rule_type === "liquidity_drop") {
      const past = await queryOne<{ liquidity_usd: number | null }>(
        `SELECT liquidity_usd FROM market_snapshots WHERE token_id = $1 AND captured_at <= now() - interval '55 minutes'
         ORDER BY captured_at DESC LIMIT 1`,
        [rule.token_id],
      );
      if (!past?.liquidity_usd || cur.liquidity_usd === null) return [];
      const drop = ((past.liquidity_usd - cur.liquidity_usd) / past.liquidity_usd) * 100;
      if (drop < Number(p.pct)) return [];
      return [{ dedupKey: `liq:${cur.id}`, link, title: `${t.symbol} liquidity down ${drop.toFixed(0)}%`, body: `Liquidity fell from $${fmt(past.liquidity_usd)} to $${fmt(cur.liquidity_usd)} in ~1h.`, payload: { drop } }];
    }
  }

  if (rule.rule_type === "security_warning" && rule.token_id) {
    const c = await queryOne<{ id: string; risk_level: string; checked_at: Date }>(
      `SELECT id, risk_level, checked_at FROM token_security_checks WHERE token_id = $1 AND checked_at > $2 ORDER BY checked_at DESC LIMIT 1`,
      [rule.token_id, since],
    );
    if (!c || LEVELS.indexOf(c.risk_level) < LEVELS.indexOf(String(p.min_level))) return [];
    const t = await tokenLabel(rule.token_id);
    return [{ dedupKey: `sec:${c.id}`, link: `/app/token/${t.chain}/${rule.token_id}`, title: `${t.symbol} security: ${c.risk_level.toUpperCase()}`, body: `A new security check rated ${t.symbol} as ${c.risk_level} risk.`, payload: { risk: c.risk_level } }];
  }

  if (rule.rule_type === "signal_score") {
    const types = (p.signal_types as string[] | undefined) ?? null;
    const sigs = await query<{ id: string; ai_score: number; signal_type: string; symbol: string; chain: string; token_id: string }>(
      `SELECT s.id, s.ai_score, s.signal_type, t.symbol, s.chain, s.token_id FROM signals s JOIN token_assets t ON t.id = s.token_id
        WHERE s.created_at > $1 AND s.ai_score >= $2 AND s.is_demo = $3
          AND ($4::text IS NULL OR s.chain = $4) AND ($5::text[] IS NULL OR s.signal_type = ANY($5))
        ORDER BY s.created_at LIMIT 10`,
      [since, Number(p.min_score), env.demoMode, rule.chain, types],
    );
    return sigs.map((s) => ({ dedupKey: `sig:${s.id}`, link: `/app/token/${s.chain}/${s.token_id}`, title: `New ${s.signal_type.replace("_", " ")} signal: ${s.symbol} (${s.ai_score})`, body: `${s.symbol} on ${s.chain} scored ${s.ai_score}/100. Signals are research, not advice.`, payload: { signal_id: s.id, score: s.ai_score } }));
  }

  if (rule.rule_type === "wallet_activity" && rule.wallet_id) {
    const dirs = (p.directions as string[] | undefined) ?? null;
    const txs = await query<{ id: string; tx_hash: string; direction: string; token_symbol: string | null; token_address: string | null; amount: number | null; label: string | null; address: string }>(
      `SELECT t.id, t.tx_hash, t.direction, t.token_symbol, t.token_address, t.amount, w.label, w.address
         FROM wallet_transactions t JOIN wallet_profiles w ON w.id = t.wallet_id
        WHERE t.wallet_id = $1 AND t.block_time > $2 AND ($3::text[] IS NULL OR t.direction = ANY($3))
        ORDER BY t.block_time LIMIT 10`,
      [rule.wallet_id, since, dirs],
    );
    return txs.map((t) => ({ dedupKey: `wtx:${t.id}`, link: `/app/wallets/${rule.wallet_id}`, title: `${t.label ?? t.address.slice(0, 6)}: ${t.direction.replace("_", " ")} ${t.token_symbol ?? t.token_address?.slice(0, 6) ?? ""}`, body: `Tx ${t.tx_hash.slice(0, 12)}… ${t.amount !== null ? `amount ${fmt(t.amount)}` : ""}`, payload: { tx: t.tx_hash } }));
  }
  return [];
}

/** Evaluates all active rules once. Duplicate events are prevented by UNIQUE(rule_id, dedup_key). */
export async function evaluateAlerts(): Promise<number> {
  const rules = await query<Rule>(
    `SELECT r.* FROM alert_rules r JOIN users u ON u.id = r.user_id
      WHERE r.is_active AND u.status = 'active'
        AND (r.last_triggered_at IS NULL OR r.last_triggered_at < now() - make_interval(mins => r.cooldown_minutes)
             OR r.rule_type IN ('signal_score', 'wallet_activity'))`,
  );
  let created = 0;
  const entCache = new Map<string, Awaited<ReturnType<typeof getEntitlements>>>();
  for (const rule of rules) {
    let triggers: Trigger[] = [];
    try {
      triggers = await evaluateRule(rule);
    } catch (err) {
      log.warn("Rule evaluation failed", { rule: rule.id, error: errorMessage(err) });
      continue;
    }
    if (!triggers.length) continue;
    if (!entCache.has(rule.user_id)) entCache.set(rule.user_id, await getEntitlements(rule.user_id));
    const ent = entCache.get(rule.user_id)!;
    const prefs = await queryOne<{ notify_in_app: boolean; notify_email: boolean; notify_telegram: boolean; telegram_chat_id: string | null }>(
      "SELECT notify_in_app, notify_email, notify_telegram, telegram_chat_id FROM profiles WHERE user_id = $1",
      [rule.user_id],
    );
    // Channels must be allowed by the plan AND enabled in the user's preferences. In-app is always kept.
    const channels = rule.channels.filter((c) => {
      if (c === "in_app") return true;
      if (!ent.features.alert_channels.includes(c as "email" | "telegram")) return false;
      if (c === "email") return prefs?.notify_email ?? true;
      if (c === "telegram") return Boolean(prefs?.notify_telegram && prefs.telegram_chat_id);
      return false;
    });
    if (!channels.includes("in_app")) channels.unshift("in_app");

    for (const t of triggers) {
      await transaction(async (tx) => {
        const [ev] = await tx.query<{ id: string }>(
          `INSERT INTO alert_events (rule_id, user_id, dedup_key, payload) VALUES ($1, $2, $3, $4)
           ON CONFLICT (rule_id, dedup_key) DO NOTHING RETURNING id`,
          [rule.id, rule.user_id, t.dedupKey, JSON.stringify(t.payload)],
        );
        if (!ev) return;
        created++;
        for (const ch of channels) {
          await tx.query(
            `INSERT INTO notifications (user_id, alert_event_id, channel, title, body, link) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (alert_event_id, channel) DO NOTHING`,
            [rule.user_id, ev.id, ch, t.title, t.body, t.link],
          );
        }
        await tx.query("UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1", [rule.id]);
      });
    }
  }
  return created;
}

const MAX_ATTEMPTS = 5;

/** Delivers pending notifications with retry; in-app notifications are delivered on creation. */
export async function deliverNotifications(): Promise<{ sent: number; failed: number }> {
  await query("UPDATE notifications SET status = 'sent', sent_at = now() WHERE status = 'pending' AND channel = 'in_app'");
  const pending = await query<{ id: string; user_id: string; channel: string; title: string; body: string; link: string | null; attempts: number; email: string; telegram_chat_id: string | null }>(
    `SELECT n.id, n.user_id, n.channel, n.title, n.body, n.link, n.attempts, u.email, p.telegram_chat_id
       FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN profiles p ON p.user_id = n.user_id
      WHERE n.status = 'pending' AND n.channel <> 'in_app'
        AND n.created_at > now() - interval '1 day'
        AND (n.attempts = 0 OR n.created_at < now() - make_interval(secs => 30 * power(2, n.attempts)::int))
      ORDER BY n.created_at LIMIT 50`,
  );
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      const url = n.link ? `${env.appUrl}${n.link}` : env.appUrl;
      if (n.channel === "email") {
        const r = await sendEmail(n.email, `[NEXALPHA] ${n.title}`, `${n.body}\n\n${url}\n\nManage alerts: ${env.appUrl}/app/alerts\nSignals are informational research, not financial advice.`);
        if (!r.delivered) throw new Error("Email provider not configured");
      } else if (n.channel === "telegram") {
        if (!n.telegram_chat_id) throw new Error("No Telegram chat linked");
        await sendTelegram(n.telegram_chat_id, `*${n.title}*\n${n.body}\n${url}`);
      }
      await query("UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [n.id]);
      sent++;
    } catch (err) {
      const final = n.attempts + 1 >= MAX_ATTEMPTS;
      await query("UPDATE notifications SET attempts = attempts + 1, last_error = $2, status = $3 WHERE id = $1", [n.id, errorMessage(err).slice(0, 500), final ? "failed" : "pending"]);
      failed++;
    }
  }
  // Undeliverable after 1 day → failed.
  await query("UPDATE notifications SET status = 'failed', last_error = COALESCE(last_error, 'Expired') WHERE status = 'pending' AND created_at < now() - interval '1 day'");
  return { sent, failed };
}
