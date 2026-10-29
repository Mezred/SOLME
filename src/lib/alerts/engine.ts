import { query, queryOne, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { errorMessage, logger } from "@/lib/log";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isChainId, type ChainId } from "@/lib/chains";
import { checkToken, passesScamCheck } from "@/lib/decision/check-token";
import { listTokens, tokenFilterSchema } from "@/lib/data/tokens";
import { formatAge } from "@/lib/format";
import { launchpadName } from "@/lib/launchpad/names";
import { EVENT_RULES, FAST_RULES } from "./rules";
import { sendTelegram, sendTelegramHtml } from "./telegram";
import { formatTelegramAlert, formatTelegramDigest, inQuietHours, launchCheckToAlert, pct as fmtPct, usd, type AlertCard, type MuteTarget } from "./telegram-format";

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
  /** Recorded (so it is never evaluated again) but not notified: the event failed the rule's quality filter. */
  silent?: boolean;
  /** Structured version for chat channels (Telegram). */
  card?: AlertCard;
}

/** Full checks are shared by every rule in a run (and briefly after), so many users alerting on one coin cost one check. */
const checkCache = new Map<string, { at: number; value: Promise<Awaited<ReturnType<typeof checkToken>>> }>();
function cachedCheck(chain: ChainId, address: string) {
  const key = `${chain}:${address}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return hit.value;
  const value = checkToken(chain, address).catch(() => null);
  checkCache.set(key, { at: Date.now(), value });
  if (checkCache.size > 500) for (const [k, v] of checkCache) if (Date.now() - v.at > 120_000) checkCache.delete(k);
  return value;
}

const fmt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 4 }) : n.toPrecision(4));
const LEVELS = ["low", "medium", "high", "critical"];

async function tokenLabel(tokenId: string) {
  return (await queryOne<{ symbol: string; chain: string; address: string | null }>("SELECT symbol, chain, address FROM token_assets WHERE id = $1", [tokenId])) ?? { symbol: "?", chain: "?", address: null };
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
    const coin = { symbol: t.symbol, chain: t.chain, address: t.address };

    if (rule.rule_type === "price_above" || rule.rule_type === "price_below") {
      const level = Number(p.price);
      const above = rule.rule_type === "price_above";
      // Fire on the crossing only: previous snapshot on the other side of the level.
      if (!prev || prev.price_usd === null) return [];
      const crossed = above ? prev.price_usd < level && cur.price_usd >= level : prev.price_usd > level && cur.price_usd <= level;
      if (!crossed) return [];
      return [{ dedupKey: `snap:${cur.id}`, link, title: `${t.symbol} crossed ${above ? "above" : "below"} $${fmt(level)}`, body: `${t.symbol} is now $${fmt(cur.price_usd)}.`, payload: { price: cur.price_usd, level },
        card: { icon: above ? "📈" : "📉", headline: `Price crossed ${above ? "above" : "below"} $${fmt(level)}`, ...coin, facts: [["Price", `$${fmt(cur.price_usd)}`], ["1h", fmtPct(cur.price_change_h1)], ["Liquidity", usd(cur.liquidity_usd)]] } }];
    }
    if (rule.rule_type === "price_change") {
      const win = String(p.window) as "m5" | "h1" | "h24";
      const ch = cur[`price_change_${win}` as const];
      if (ch === null) return [];
      const pct = Number(p.pct);
      const dir = String(p.direction);
      const hit = dir === "up" ? ch >= pct : dir === "down" ? ch <= -pct : Math.abs(ch) >= pct;
      if (!hit) return [];
      return [{ dedupKey: `chg:${win}:${Math.floor(Date.now() / (rule.cooldown_minutes * 60_000))}`, link, title: `${t.symbol} ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}% (${win})`, body: `${t.symbol} moved ${ch.toFixed(1)}% over ${win}; price $${fmt(cur.price_usd)}.`, payload: { change: ch, window: win },
        card: { icon: ch >= 0 ? "📈" : "📉", headline: `Price moved ${fmtPct(ch)} (${win.replace("m5", "5m").replace("h1", "1h").replace("h24", "24h")})`, ...coin, facts: [["Price", `$${fmt(cur.price_usd)}`], ["Liquidity", usd(cur.liquidity_usd)], ["Volume 24h", usd(cur.volume_h24)]] } }];
    }
    if (rule.rule_type === "volume_spike") {
      if (!cur.volume_h1 || !cur.volume_h24) return [];
      const ratio = cur.volume_h1 / (cur.volume_h24 / 24);
      if (ratio < Number(p.multiple)) return [];
      return [{ dedupKey: `vol:${Math.floor(Date.now() / (rule.cooldown_minutes * 60_000))}`, link, title: `${t.symbol} volume spike ${ratio.toFixed(1)}×`, body: `Last-hour volume is ${ratio.toFixed(1)}× the 24h hourly average.`, payload: { ratio },
        card: { icon: "📊", headline: `Volume spike ${ratio.toFixed(1)}×`, ...coin, facts: [["Volume 1h", usd(cur.volume_h1)], ["Volume 24h", usd(cur.volume_h24)], ["Price", `$${fmt(cur.price_usd)}`], ["1h", fmtPct(cur.price_change_h1)]] } }];
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
      return [{ dedupKey: `liq:${cur.id}`, link, title: `${t.symbol} liquidity down ${drop.toFixed(0)}%`, body: `Liquidity fell from $${fmt(past.liquidity_usd)} to $${fmt(cur.liquidity_usd)} in ~1h.`, payload: { drop },
        card: { icon: "💧", headline: `Liquidity down ${drop.toFixed(0)}% in 1h`, ...coin, facts: [["Before", usd(past.liquidity_usd)], ["Now", usd(cur.liquidity_usd)], ["Price", `$${fmt(cur.price_usd)}`]], note: "A fast liquidity drop can mean the pool is being pulled." } }];
    }
  }

  if (rule.rule_type === "security_warning" && rule.token_id) {
    const c = await queryOne<{ id: string; risk_level: string; checked_at: Date }>(
      `SELECT id, risk_level, checked_at FROM token_security_checks WHERE token_id = $1 AND checked_at > $2 ORDER BY checked_at DESC LIMIT 1`,
      [rule.token_id, since],
    );
    if (!c || LEVELS.indexOf(c.risk_level) < LEVELS.indexOf(String(p.min_level))) return [];
    const t = await tokenLabel(rule.token_id);
    return [{ dedupKey: `sec:${c.id}`, link: `/app/token/${t.chain}/${rule.token_id}`, title: `${t.symbol} security: ${c.risk_level.toUpperCase()}`, body: `A new security check rated ${t.symbol} as ${c.risk_level} risk.`, payload: { risk: c.risk_level },
      card: { icon: "🛡️", headline: `Security risk: ${c.risk_level}`, symbol: t.symbol, chain: t.chain, address: t.address, facts: [["Risk level", c.risk_level.toUpperCase()]], note: "Open the coin for the full contract report." } }];
  }

  // Trades by one followed wallet (wallet_id) or by every wallet the user follows: any coin, scam check optional.
  if (rule.rule_type === "wallet_activity") {
    const dirs = Array.isArray(p.directions) && p.directions.length ? (p.directions as string[]) : null;
    const minSol = Number(p.min_sol ?? 0);
    const rows = await query<{
      id: string; chain: string; tx_hash: string; direction: string; token_address: string | null; symbol: string | null; amount: number | null;
      usd: number | null; sol: number | null; estimated: boolean; price: number | null; mcap: number | null; entry: number | null;
      block_time: Date; address: string; label: string | null; score: number | null; counterparty: string | null; wallet_id: string;
    }>(
      `SELECT x.id, x.chain, x.tx_hash, x.direction, x.token_address, COALESCE(ta.symbol, x.token_symbol) AS symbol, x.amount, x.amount_usd AS usd,
              (x.raw->>'sol')::numeric AS sol, COALESCE((x.raw->>'solEstimated')::boolean, false) AS estimated,
              (x.raw->>'priceUsdAtDetection')::numeric AS price, (x.raw->>'mcapAtDetection')::numeric AS mcap, x.block_time, x.counterparty,
              w.address, COALESCE(t.custom_label, w.label) AS label, s.score, x.wallet_id,
              CASE WHEN x.direction = 'sell' THEN
                (SELECT avg((b.raw->>'priceUsdAtDetection')::numeric) FROM wallet_transactions b
                  WHERE b.wallet_id = x.wallet_id AND b.token_address = x.token_address AND b.direction = 'buy'
                    AND b.block_time < x.block_time AND b.block_time > x.block_time - interval '7 days') END AS entry
         FROM wallet_transactions x
         JOIN user_tracked_wallets t ON t.wallet_id = x.wallet_id AND t.user_id = $1
         JOIN wallet_profiles w ON w.id = x.wallet_id
         LEFT JOIN wallet_scores s ON s.wallet_id = w.id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE ($2::uuid IS NULL OR x.wallet_id = $2)
          AND x.block_time > GREATEST($3::timestamptz, t.created_at, now() - interval '6 hours')
          AND ($4::text[] IS NULL OR x.direction = ANY($4))
          AND ($5::numeric = 0 OR x.direction NOT IN ('buy', 'sell') OR COALESCE((x.raw->>'sol')::numeric, 0) >= $5)
          -- The 10-minute history sync can also list a swap as transfers; the swap row already covers it.
          AND NOT (x.direction LIKE 'transfer%' AND EXISTS (SELECT 1 FROM wallet_transactions y
                     WHERE y.wallet_id = x.wallet_id AND y.tx_hash = x.tx_hash AND y.direction IN ('buy', 'sell')))
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $6 AND e.dedup_key = 'wtx:' || x.id::text)
        ORDER BY x.block_time LIMIT ${EVENT_BATCH}`,
      [rule.user_id, rule.wallet_id, rule.created_at, dirs, minSol, rule.id],
    );
    const out: Trigger[] = [];
    for (const r of rows) {
      const who = r.label ?? `${r.address.slice(0, 4)}…${r.address.slice(-4)}`;
      const name = r.symbol ?? r.token_address?.slice(0, 6) ?? "a token";
      const sol = r.sol !== null ? Number(r.sol) : null;
      const value = sol !== null ? `${r.estimated ? "≈" : ""}${fmt(sol)} SOL${r.usd !== null ? ` (${usd(Number(r.usd))})` : ""}` : r.usd !== null ? usd(Number(r.usd)) : null;
      const move = r.direction === "sell" && r.entry && r.price ? (Number(r.price) / Number(r.entry) - 1) * 100 : null;
      const verb = { buy: "bought", sell: "sold", transfer_out: "sent out", transfer_in: "received" }[r.direction] ?? r.direction;
      const icon = { buy: "🟢", sell: "🔴", transfer_out: "📤", transfer_in: "📥" }[r.direction] ?? "👛";
      const facts: [string, string][] = [["Wallet", `${who}${r.score !== null ? ` (score ${r.score})` : ""}`]];
      if (r.direction === "buy" && value) facts.push(["Spent", value]);
      if (r.direction === "sell" && value) facts.push(["Received", value]);
      if (r.direction.startsWith("transfer") && r.amount !== null) facts.push(["Amount", `${fmt(Number(r.amount))} ${name}${value ? ` (${value})` : ""}`]);
      if (r.direction === "transfer_out" && r.counterparty) facts.push(["To", `${r.counterparty.slice(0, 4)}…${r.counterparty.slice(-4)}`]);
      if (r.price !== null && !r.direction.startsWith("transfer")) facts.push(["Price", usd(Number(r.price))]);
      if (r.mcap !== null) facts.push(["Market cap", usd(Number(r.mcap))]);
      if (move !== null) facts.push(["Since their buy", fmtPct(move)]);
      if (r.estimated && sol !== null) facts.push(["Swap", "token ↔ token (SOL value estimated)"]);
      const mute: MuteTarget[] = [{ kind: "wallet", value: r.address }, ...(r.token_address ? [{ kind: "coin" as const, value: r.token_address }] : [])];
      const trigger: Trigger = {
        dedupKey: `wtx:${r.id}`,
        link: `/app/wallets/${r.wallet_id}`,
        title: `${who} ${verb} ${name}${value ? ` · ${value}` : ""}${move !== null ? ` (${fmtPct(move)})` : ""}`,
        body: `${facts.map(([k, v]) => `${k}: ${v}`).join(" · ")}. Tx ${r.tx_hash.slice(0, 12)}…`,
        payload: { tx: r.tx_hash, wallet: r.address, mint: r.token_address },
        card: {
          icon,
          headline: `Followed wallet ${verb}`,
          symbol: r.symbol,
          chain: r.chain,
          address: r.token_address,
          facts,
          note: r.direction === "buy" ? "Not checked for scams: send the contract to the bot before you copy." : undefined,
          replyTo: r.direction === "sell" && r.token_address ? r.token_address : undefined,
          mute,
        },
      };
      if (r.direction !== "buy" || p.pass_check !== true || !r.token_address || !isChainId(r.chain)) {
        out.push(trigger);
        continue;
      }
      // Buys with the scam check on: wait up to 10 minutes for a DEX market, then alert only when it passes.
      const c = await cachedCheck(r.chain, r.token_address);
      if (!c) {
        if (Date.now() - new Date(r.block_time).getTime() > 10 * 60_000) out.push({ ...trigger, silent: true });
        continue;
      }
      out.push({
        ...trigger,
        link: `/app/token/${r.chain}/${c.tokenId}`,
        card: { ...trigger.card!, headline: `Followed wallet bought · ${c.decision.verdict}`, facts: [...facts, ["Scam check", "passed"]], note: "Research, not advice." },
        silent: !passesScamCheck(c.decision),
      });
    }
    return out;
  }

  // Launchpad and smart-wallet events can be recorded late (rotating wallet polls, on-chain LetsBonk resolution)
  // or in bursts, so these rules do not use last_triggered_at as a watermark. They look back over a window
  // (never before the rule existed) and skip only events this rule has already alerted on.
  if (rule.rule_type === "screener_match") {
    const tpl = await queryOne<{ name: string; params: Record<string, string> }>("SELECT name, params FROM screener_templates WHERE id = $1 AND user_id = $2", [p.template_id, rule.user_id]);
    if (!tpl) return [];
    const ent = await getEntitlements(rule.user_id);
    // The Screener's own filter code, on the most recently refreshed matches.
    const filters = { ...tokenFilterSchema.parse(tpl.params), sort: "updated" as const, dir: "desc" as const, page: 1, pageSize: SCREENER_SCAN };
    const { rows } = await listTokens(filters, ent.features.chains, { advanced: ent.features.advanced_filters });
    const keys = rows.map((r) => `scr:${r.id}`);
    const seen = new Set((await query<{ dedup_key: string }>("SELECT dedup_key FROM alert_events WHERE rule_id = $1 AND dedup_key = ANY($2)", [rule.id, [...keys, "scr:baseline"]])).map((e) => e.dedup_key));
    const fresh = rows.filter((r) => !seen.has(`scr:${r.id}`));
    const quiet = (dedupKey: string): Trigger => ({ dedupKey, title: "", body: "", link: null, payload: {}, silent: true });
    // First run: what already matches is the baseline and is recorded silently; only coins that start matching alert.
    if (!seen.has("scr:baseline")) return [quiet("scr:baseline"), ...fresh.map((r) => quiet(`scr:${r.id}`))];
    return fresh.slice(0, SCREENER_ALERTS_PER_RUN).map((r) => {
      const mcap = r.market_cap ?? r.fdv;
      const txns = r.buys_h24 !== null && r.sells_h24 !== null ? r.buys_h24 + r.sells_h24 : null;
      return {
        dedupKey: `scr:${r.id}`,
        link: `/app/token/${r.chain}/${r.id}`,
        title: `${r.symbol} matches your "${tpl.name}" filters`,
        body: `Market cap ${usd(mcap)} · liquidity ${usd(r.liquidity_usd)} · 24h volume ${usd(r.volume_h24)} · 1h ${fmtPct(r.price_change_h1)}. Research, not advice.`,
        payload: { token_id: r.id, template_id: p.template_id },
        card: {
          icon: "🔎",
          headline: `Matches "${tpl.name}"`,
          symbol: r.symbol,
          chain: r.chain,
          address: r.address,
          facts: [
            ["Market cap", usd(mcap)],
            ["Liquidity", usd(r.liquidity_usd)],
            ["Volume 24h", usd(r.volume_h24)],
            ["Txns 24h", txns !== null ? txns.toLocaleString("en-US") : "n/a"],
            ["1h / 6h / 24h", `${fmtPct(r.price_change_h1)} / ${fmtPct(r.price_change_h6)} / ${fmtPct(r.price_change_h24)}`],
            ["Pair age", r.pair_created_at ? formatAge(r.pair_created_at) : "n/a"],
          ] as [string, string][],
          note: "Matching your filters is not a safety check: send the contract to the bot or open Check a coin.",
        },
      };
    });
  }

  if (rule.rule_type === "dev_deploy") {
    const rows = await query<{
      mint: string; chain: string; symbol: string | null; pool: string; creator: string; dev_score_at_launch: number; dev_launches_at_launch: number | null; initial_buy_sol: number | null;
      check_passed: boolean | null; check_reason: string | null; checked: boolean; bundle_pct: number | null; sniper_wallets: number | null; sniper_pct: number | null;
    }>(
      `SELECT l.mint, l.chain, l.symbol, l.pool, l.creator, l.dev_score_at_launch, l.dev_launches_at_launch, l.initial_buy_sol,
              lc.passed AS check_passed, lc.reason AS check_reason, (lc.mint IS NOT NULL) AS checked,
              lc.bundle_pct, lc.sniper_wallets, lc.sniper_pct
         FROM launchpad_tokens l LEFT JOIN launch_checks lc ON lc.mint = l.mint
        WHERE l.source = 'stream' AND l.created_at > GREATEST($1::timestamptz, now() - interval '2 hours')
          AND l.dev_score_at_launch >= $2 AND COALESCE(l.dev_launches_at_launch, 0) >= 2
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $3 AND e.dedup_key = 'dev:' || l.mint)
        ORDER BY l.created_at LIMIT ${EVENT_BATCH}`,
      [rule.created_at, Number(p.min_dev_score), rule.id],
    );
    const launches: Trigger[] = rows.map((r) => ({
      dedupKey: `dev:${r.mint}`,
      link: "/app/smart-dev",
      title: `Proven dev launched ${r.symbol ?? r.mint.slice(0, 6)} (dev score ${r.dev_score_at_launch})`,
      body: `${launchpadName(r.pool)} · ${r.dev_launches_at_launch ?? "?"} earlier launches by this creator. Mint ${r.mint}. A good record does not make a new launch safe.`,
      payload: { mint: r.mint, dev_score: r.dev_score_at_launch },
      card: {
        icon: "🚀",
        headline: "Proven dev just launched",
        symbol: r.symbol,
        chain: r.chain,
        pool: r.pool,
        address: r.mint,
        facts: [
          ["Dev score", String(r.dev_score_at_launch)],
          ["Earlier launches", String(r.dev_launches_at_launch ?? "?")],
          ...(r.initial_buy_sol !== null ? [["Dev buy", `${fmt(Number(r.initial_buy_sol))} SOL`] as [string, string]] : []),
          // Known already when the alert was delayed; otherwise added to the sent message ~20s after launch.
          ...(r.bundle_pct !== null && r.sniper_pct !== null
            ? [["Launch bundle", `${Number(r.bundle_pct).toFixed(1)}% of supply`], ["Snipers (first 10s)", `${r.sniper_wallets ?? 0} wallets · ${Number(r.sniper_pct).toFixed(1)}%`]] as [string, string][]
            : []),
        ],
        // Sent right away; the message is edited with the result when the background check finishes.
        check: launchCheckToAlert(r.checked ? { passed: r.check_passed, reason: r.check_reason } : null),
        note: "A good dev record does not make a new launch safe.",
        mute: [{ kind: "dev", value: r.creator }, { kind: "coin", value: r.mint }] as MuteTarget[],
      },
    }));

    // Follow-up on coins this rule already alerted: their creator sold (seen live, src/lib/wallets/live.ts).
    const sells = await query<{ signature: string; mint: string; creator: string; chain: string; symbol: string | null; pool: string; sol: number | null; supply_pct: number | null; total_pct: number | null }>(
      `SELECT s.signature, s.mint, s.creator, l.chain, l.symbol, l.pool, s.sol, s.supply_pct,
              (SELECT sum(x.supply_pct) FROM dev_sells x WHERE x.mint = s.mint AND x.sold_at <= s.sold_at) AS total_pct
         FROM dev_sells s JOIN launchpad_tokens l ON l.mint = s.mint
        WHERE s.sold_at > now() - interval '6 hours'
          AND EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $1 AND e.dedup_key = 'dev:' || s.mint)
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $1 AND e.dedup_key = 'devsell:' || s.signature)
        ORDER BY s.sold_at LIMIT ${EVENT_BATCH}`,
      [rule.id],
    );
    const sold: Trigger[] = sells.map((r) => {
      const name = r.symbol ?? r.mint.slice(0, 6);
      const part = r.supply_pct !== null ? `${Number(r.supply_pct).toFixed(1)}% of supply` : "part of their bag";
      return {
        dedupKey: `devsell:${r.signature}`,
        link: "/app/smart-dev",
        title: `Dev sold ${name}: ${part}`,
        body: `The creator of ${name} sold ${part}${r.sol !== null ? ` for ${fmt(Number(r.sol))} SOL` : ""}. Mint ${r.mint}.`,
        payload: { mint: r.mint, signature: r.signature },
        card: {
          icon: "🚨",
          headline: "Dev sold",
          symbol: r.symbol,
          chain: r.chain,
          pool: r.pool,
          address: r.mint,
          facts: [
            ["This sale", `${part}${r.sol !== null ? ` · ${fmt(Number(r.sol))} SOL` : ""}`],
            ...(r.total_pct !== null ? [["Sold so far", `${Number(r.total_pct).toFixed(1)}% of supply`] as [string, string]] : []),
          ],
          note: "The creator is selling their own coin. Often the start of the exit.",
          replyTo: r.mint,
          mute: [{ kind: "dev", value: r.creator }, { kind: "coin", value: r.mint }],
        },
      };
    });
    return [...launches, ...sold];
  }

  if (rule.rule_type === "curve_progress") {
    const rows = await query<{ mint: string; chain: string; symbol: string | null; pool: string; progress: number; market_cap_usd: number | null; dev_score: number | null }>(
      `SELECT l.mint, l.chain, l.symbol, l.pool, l.progress, l.market_cap_usd, COALESCE(l.dev_score_at_launch, d.score) AS dev_score
         FROM launchpad_tokens l LEFT JOIN dev_profiles d ON d.creator = l.creator
        WHERE l.source = 'stream' AND NOT l.complete AND l.migrated_at IS NULL AND l.created_at > now() - interval '6 hours'
          AND l.progress >= $1 AND l.checked_at > $2 AND COALESCE(l.dev_score_at_launch, d.score, 0) >= $3
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $4 AND e.dedup_key = 'curve:' || l.mint)
        ORDER BY l.progress DESC LIMIT ${EVENT_BATCH}`,
      [Number(p.min_progress) / 100, rule.created_at, Number(p.min_dev_score), rule.id],
    );
    return rows.map((r) => ({
      dedupKey: `curve:${r.mint}`,
      link: `/app/check?q=${encodeURIComponent(r.mint)}`,
      title: `${r.symbol ?? r.mint.slice(0, 6)} bonding curve ${Math.round(r.progress * 100)}%`,
      body: `${launchpadName(r.pool)} · market cap ${r.market_cap_usd !== null ? `$${fmt(r.market_cap_usd)}` : "n/a"} · dev score ${r.dev_score ?? "none"}. Mint ${r.mint}.`,
      payload: { mint: r.mint, progress: r.progress },
      card: {
        icon: "📈",
        headline: `Bonding curve ${Math.round(r.progress * 100)}%`,
        symbol: r.symbol,
        chain: r.chain,
        pool: r.pool,
        address: r.mint,
        facts: [["Curve", `${Math.round(r.progress * 100)}%`], ["Market cap", usd(r.market_cap_usd)], ["Dev score", r.dev_score !== null ? String(r.dev_score) : "none"]],
        note: "Close to migrating to a DEX pool.",
      },
    }));
  }

  if (rule.rule_type === "smart_wallet_buy") {
    const followedOnly = p.followed_only === true;
    const rows = await query<{ id: string; chain: string; token_address: string; token_symbol: string | null; address: string; score: number | null; sol: number | null; block_time: Date }>(
      `SELECT x.id, x.chain, x.token_address, x.token_symbol, w.address, s.score, (x.raw->>'sol')::numeric AS sol, x.block_time
         FROM wallet_transactions x JOIN wallet_profiles w ON w.id = x.wallet_id LEFT JOIN wallet_scores s ON s.wallet_id = w.id
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > GREATEST($1::timestamptz, now() - interval '6 hours')
          AND (CASE WHEN $5 THEN x.wallet_id IN (SELECT wallet_id FROM user_tracked_wallets WHERE user_id = $6)
                    ELSE s.score >= $2 AND NOT s.bot_like END)
          AND COALESCE((x.raw->>'sol')::numeric, 0) >= $3
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $4 AND e.dedup_key = 'swb:' || x.id::text)
        ORDER BY x.block_time LIMIT ${EVENT_BATCH}`,
      [rule.created_at, Number(p.min_wallet_score), Number(p.min_buy_sol), rule.id, followedOnly, rule.user_id],
    );
    const out: Trigger[] = [];
    for (const r of rows) {
      const who = `${followedOnly ? "Followed wallet" : "Smart wallet"}${r.score !== null ? ` (score ${r.score})` : ""}`;
      const spent = r.sol !== null ? `${fmt(r.sol)} SOL` : "an unknown amount";
      const base = { dedupKey: `swb:${r.id}`, payload: { mint: r.token_address, wallet: r.address, score: r.score } as Record<string, unknown> };
      const walletFacts: [string, string][] = [
        ["Wallet", `${r.address.slice(0, 4)}…${r.address.slice(-4)}${r.score !== null ? ` (score ${r.score})` : ""}`],
        ["Spent", spent],
      ];
      if (p.pass_check !== true || !isChainId(r.chain)) {
        out.push({
          ...base,
          link: "/app/smart-money",
          title: `${who} bought ${r.token_symbol ?? r.token_address.slice(0, 6)}`,
          body: `${r.address.slice(0, 6)}… spent ${spent}. Token ${r.token_address}. Scores describe past trades only.`,
          card: { icon: "🐋", headline: `${who} bought`, symbol: r.token_symbol, chain: r.chain, address: r.token_address, facts: walletFacts, note: "Wallet scores describe past trades only.",
            mute: [{ kind: "wallet", value: r.address }, { kind: "coin", value: r.token_address }] },
        });
        continue;
      }
      const c = await cachedCheck(r.chain, r.token_address);
      // A coin with no DEX market yet cannot be checked: wait up to 10 minutes for it to list, then drop the event.
      if (!c) {
        if (Date.now() - new Date(r.block_time).getTime() > 10 * 60_000) out.push({ ...base, link: null, title: "", body: "", silent: true });
        continue;
      }
      const d = c.decision;
      out.push({
        ...base,
        link: `/app/token/${r.chain}/${c.tokenId}`,
        title: `[${d.verdict.toUpperCase()}] ${who} bought ${c.symbol}`,
        body: `Spent ${spent}. Scam check passed: ${d.gate.filter((g) => g.status === "pass").map((g) => g.label.toLowerCase()).join(", ")}. ${d.reasons[0] ?? ""} Research, not advice.`,
        payload: { ...base.payload, verdict: d.verdict },
        card: {
          icon: "🐋",
          headline: `${who} bought · ${d.verdict}`,
          symbol: c.symbol,
          chain: r.chain,
          address: r.token_address,
          facts: [...walletFacts, ["Scam check", "passed"], ["Checks OK", d.gate.filter((g) => g.status === "pass").map((g) => g.label.toLowerCase()).join(", ") || "n/a"]],
          note: "Research, not advice.",
          mute: [{ kind: "wallet", value: r.address }, { kind: "coin", value: r.token_address }],
        },
        silent: !passesScamCheck(d),
      });
    }

    // Follow-up: a wallet this rule alerted on sold that coin (within 48h). Sent as a reply under the buy alert.
    const sells = await query<{ id: string; chain: string; token_address: string; token_symbol: string | null; address: string; sol: number | null; exit: number | null; entry: number | null }>(
      `SELECT x.id, x.chain, x.token_address, x.token_symbol, w.address, (x.raw->>'sol')::numeric AS sol, (x.raw->>'priceUsdAtDetection')::numeric AS exit,
              (SELECT avg((b.raw->>'priceUsdAtDetection')::numeric) FROM wallet_transactions b
                WHERE b.wallet_id = x.wallet_id AND b.token_address = x.token_address AND b.direction = 'buy' AND b.block_time < x.block_time
                  AND b.block_time > x.block_time - interval '48 hours') AS entry
         FROM wallet_transactions x JOIN wallet_profiles w ON w.id = x.wallet_id
        WHERE x.provider = 'helius-rpc' AND x.direction = 'sell' AND x.block_time > GREATEST($2::timestamptz, now() - interval '48 hours')
          AND EXISTS (SELECT 1 FROM alert_events e JOIN notifications n ON n.alert_event_id = e.id
                       WHERE e.rule_id = $1 AND e.dedup_key LIKE 'swb:%' AND e.payload->>'wallet' = w.address AND e.payload->>'mint' = x.token_address
                         AND e.triggered_at < x.block_time + interval '5 minutes')
          AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.rule_id = $1 AND e.dedup_key = 'sws:' || x.id::text)
        ORDER BY x.block_time LIMIT ${EVENT_BATCH}`,
      [rule.id, rule.created_at],
    );
    for (const r of sells) {
      const name = r.token_symbol ?? r.token_address.slice(0, 6);
      const move = r.entry && r.exit ? (Number(r.exit) / Number(r.entry) - 1) * 100 : null;
      out.push({
        dedupKey: `sws:${r.id}`,
        link: "/app/smart-money",
        title: `Smart wallet sold ${name}${move !== null ? ` (${fmtPct(move)} since the buy alert)` : ""}`,
        body: `Wallet ${r.address.slice(0, 4)}…${r.address.slice(-4)} sold ${name}${r.sol !== null ? ` for ${fmt(Number(r.sol))} SOL` : ""}.`,
        payload: { mint: r.token_address, wallet: r.address },
        card: {
          icon: "🔻",
          headline: "Smart wallet sold",
          symbol: r.token_symbol,
          chain: r.chain,
          address: r.token_address,
          facts: [
            ["Wallet", `${r.address.slice(0, 4)}…${r.address.slice(-4)}`],
            ...(r.sol !== null ? [["Received", `${fmt(Number(r.sol))} SOL`] as [string, string]] : []),
            ...(move !== null ? [["Since the buy alert", fmtPct(move)] as [string, string]] : []),
          ],
          note: "The wallet you got the buy alert for is exiting.",
          replyTo: r.token_address,
          mute: [{ kind: "wallet", value: r.address }, { kind: "coin", value: r.token_address }],
        },
      });
    }
    return out;
  }

  if (rule.rule_type === "smart_group_buy") {
    const rows = await query<{ token_address: string; chain: string; symbol: string | null; wallets: number; sol: number | null; first_at: Date; last_at: Date; top: number }>(
      `SELECT x.token_address, max(x.chain) AS chain, max(COALESCE(ta.symbol, x.token_symbol)) AS symbol, count(DISTINCT x.wallet_id)::int AS wallets,
              sum((x.raw->>'sol')::numeric) AS sol, min(x.block_time) AS first_at, max(x.block_time) AS last_at, max(s.score)::int AS top
         FROM wallet_transactions x JOIN wallet_scores s ON s.wallet_id = x.wallet_id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > now() - make_interval(mins => $1)
          AND s.score >= $2 AND NOT s.bot_like
        GROUP BY x.token_address
       HAVING count(DISTINCT x.wallet_id) >= $3 AND max(x.block_time) > $4`,
      [Number(p.window_minutes), Number(p.min_wallet_score), Number(p.min_wallets), rule.created_at],
    );
    const day = Math.floor(Date.now() / 86_400_000);
    return rows.map((r) => {
      const name = r.symbol ?? r.token_address.slice(0, 6);
      const span = Math.max(1, Math.round((new Date(r.last_at).getTime() - new Date(r.first_at).getTime()) / 60_000));
      return {
        // Once per coin per day, however many more wallets join.
        dedupKey: `grp:${r.token_address}:${day}`,
        link: `/app/check?q=${encodeURIComponent(r.token_address)}`,
        title: `${r.wallets} smart wallets bought ${name} within ${span} min`,
        body: `${r.wallets} wallets scoring ${Number(p.min_wallet_score)}+ bought ${name}${r.sol !== null ? `, ${fmt(Number(r.sol))} SOL in total` : ""}. Check the coin before buying. Research, not advice.`,
        payload: { mint: r.token_address, wallets: r.wallets },
        card: {
          icon: "👥",
          headline: `${r.wallets} smart wallets bought`,
          symbol: r.symbol,
          chain: r.chain,
          address: r.token_address,
          facts: [
            ["Wallets", `${r.wallets} (best score ${r.top})`],
            ...(r.sol !== null ? [["Total spent", `${fmt(Number(r.sol))} SOL`] as [string, string]] : []),
            ["Within", `${span} min`],
          ],
          note: "Send the contract to the bot for the scam check before you buy.",
        },
      };
    });
  }
  return [];
}


/** Max new events per launchpad/smart-wallet rule per run; the rest are picked up on the next run. */
const EVENT_BATCH = 25;
/** Screener alerts: matches read per run, and at most this many alerts per template per run (the rest follow). */
const SCREENER_SCAN = 200;
const SCREENER_ALERTS_PER_RUN = 5;

/**
 * Evaluates active rules once. With `types`, only those rule types (the fast launchpad job); without, every
 * other type (the regular cycle), so fast rules are not evaluated twice.
 * Duplicate events are prevented by UNIQUE(rule_id, dedup_key).
 */
export async function evaluateAlerts(types?: string[]): Promise<number> {
  const rules = await query<Rule>(
    `SELECT r.* FROM alert_rules r JOIN users u ON u.id = r.user_id
      WHERE r.is_active AND u.status = 'active'
        AND (r.last_triggered_at IS NULL OR r.last_triggered_at < now() - make_interval(mins => r.cooldown_minutes)
             OR r.rule_type = ANY($1))
        AND (CASE WHEN $2::text[] IS NULL THEN NOT (r.rule_type = ANY($3)) ELSE r.rule_type = ANY($2) END)`,
    [EVENT_RULES, types ?? null, FAST_RULES],
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
    // One-click presets follow the account's Telegram setting at send time, so switching one on before
    // connecting Telegram does not leave it in-app only.
    const wanted = typeof rule.params.preset === "string" && !rule.channels.includes("telegram") ? [...rule.channels, "telegram"] : rule.channels;
    // Channels must be allowed by the plan AND enabled in the user's preferences. In-app is always kept.
    const channels = wanted.filter((c) => {
      if (c === "in_app") return true;
      if (!ent.features.alert_channels.includes(c as "email" | "telegram")) return false;
      if (c === "email") return prefs?.notify_email ?? true;
      if (c === "telegram") return Boolean(prefs?.notify_telegram && prefs.telegram_chat_id);
      return false;
    });
    if (!channels.includes("in_app")) channels.unshift("in_app");

    // 🔕 mutes: the alert is recorded (so it never fires later) but not sent.
    const muted = new Set(
      (await query<{ kind: string; value: string }>("SELECT kind, value FROM alert_mutes WHERE user_id = $1 AND until > now()", [rule.user_id])).map((m) => `${m.kind}:${m.value}`),
    );
    for (const t of triggers) {
      if (t.card && !t.card.mute && t.card.address) t.card.mute = [{ kind: "coin", value: t.card.address }];
      if (!t.silent && t.card?.mute?.some((m) => muted.has(`${m.kind}:${m.value}`))) t.silent = true;
    }

    for (const t of triggers) {
      await transaction(async (tx) => {
        const [ev] = await tx.query<{ id: string }>(
          `INSERT INTO alert_events (rule_id, user_id, dedup_key, payload) VALUES ($1, $2, $3, $4)
           ON CONFLICT (rule_id, dedup_key) DO NOTHING RETURNING id`,
          [rule.id, rule.user_id, t.dedupKey, JSON.stringify(t.payload)],
        );
        if (!ev || t.silent) return;
        created++;
        for (const ch of channels) {
          await tx.query(
            `INSERT INTO notifications (user_id, alert_event_id, channel, title, body, link, meta) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (alert_event_id, channel) DO NOTHING`,
            [rule.user_id, ev.id, ch, t.title, t.body, t.link, t.card ? JSON.stringify(t.card) : null],
          );
        }
        await tx.query("UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1", [rule.id]);
      });
    }
  }
  return created;
}

const MAX_ATTEMPTS = 5;

/** Telegram legacy Markdown rejects the whole message on stray _ * ` [ — common in memecoin names. */
export const escapeMarkdown = (s: string) => s.replace(/([_*`[])/g, "\\$1");

/** A queued alert can wait for retries: show the coin's scam check as it stands at send time. */
async function withLatestCheck(card: AlertCard): Promise<AlertCard> {
  if (!card.check || !card.address) return card;
  const row = await queryOne<{ passed: boolean | null; reason: string | null }>("SELECT passed, reason FROM launch_checks WHERE mint = $1", [card.address]);
  return row ? { ...card, check: launchCheckToAlert(row) } : card;
}

let delivering: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Delivers pending notifications with retry; in-app notifications are delivered on creation. One run at a time per
 * process (the job worker and the live wallet feed both call it), so a message is never sent twice.
 */
export function deliverNotifications(): Promise<{ sent: number; failed: number }> {
  delivering ??= deliverPending().finally(() => {
    delivering = null;
  });
  return delivering;
}

/** Telegram allows about one message per second per chat: past this many per run, the rest go out as one summary. */
const TG_PER_CHAT_PER_RUN = 4;

interface PendingRow {
  id: string;
  user_id: string;
  channel: string;
  title: string;
  body: string;
  link: string | null;
  meta: AlertCard | null;
  attempts: number;
  digest: boolean;
  email: string;
  telegram_chat_id: string | null;
  timezone: string | null;
  quiet_start: string | null;
  quiet_end: string | null;
}

async function deliverPending(): Promise<{ sent: number; failed: number }> {
  await query("UPDATE notifications SET status = 'sent', sent_at = now() WHERE status = 'pending' AND channel = 'in_app'");
  const pending = await query<PendingRow>(
    `SELECT n.id, n.user_id, n.channel, n.title, n.body, n.link, n.meta, n.attempts, n.digest, u.email, p.telegram_chat_id, p.timezone, p.quiet_start, p.quiet_end
       FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN profiles p ON p.user_id = n.user_id
      WHERE n.status = 'pending' AND n.channel <> 'in_app'
        AND n.created_at > now() - interval '1 day'
        AND (n.attempts = 0 OR n.created_at < now() - make_interval(secs => 30 * power(2, n.attempts)::int))
      ORDER BY n.created_at LIMIT 100`,
  );
  let sent = 0;
  let failed = 0;
  const done = async (rows: PendingRow[]) => {
    await query("UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ANY($1)", [rows.map((r) => r.id)]);
    sent += rows.length;
  };
  const fail = async (rows: PendingRow[], err: unknown) => {
    for (const n of rows) {
      const final = n.attempts + 1 >= MAX_ATTEMPTS;
      await query("UPDATE notifications SET attempts = attempts + 1, last_error = $2, status = $3 WHERE id = $1", [n.id, errorMessage(err).slice(0, 500), final ? "failed" : "pending"]);
      log.warn("Notification delivery failed", { channel: n.channel, attempt: n.attempts + 1, final, error: errorMessage(err) });
    }
    failed += rows.length;
  };

  const telegram = new Map<string, PendingRow[]>();
  for (const n of pending) {
    if (n.channel === "telegram") {
      telegram.set(n.user_id, [...(telegram.get(n.user_id) ?? []), n]);
      continue;
    }
    try {
      const url = n.link ? `${env.appUrl}${n.link}` : env.appUrl;
      const r = await sendEmail(n.email, `[SOLME] ${n.title}`, `${n.body}\n\n${url}\n\nManage alerts: ${env.appUrl}/app/alerts\nSOLME alerts are informational research, not financial advice.`);
      if (!r.delivered) throw new Error("Email provider not configured");
      await done([n]);
    } catch (err) {
      await fail([n], err);
    }
  }

  for (const rows of telegram.values()) {
    const chat = rows[0].telegram_chat_id;
    if (!chat) {
      await fail(rows, new Error("No Telegram chat linked"));
      continue;
    }
    // Quiet hours: hold everything for one summary when they end.
    if (inQuietHours(rows[0].quiet_start, rows[0].quiet_end, rows[0].timezone ?? "UTC")) {
      const fresh = rows.filter((r) => !r.digest);
      if (fresh.length) await query("UPDATE notifications SET digest = true WHERE id = ANY($1)", [fresh.map((r) => r.id)]);
      continue;
    }
    const digest = async (header: string, group: PendingRow[]) => {
      if (!group.length) return;
      try {
        await sendTelegramHtml(chat, formatTelegramDigest(header, group.map((r) => ({ title: r.title, card: r.meta }))));
        await done(group);
      } catch (err) {
        await fail(group, err);
      }
    };
    const held = rows.filter((r) => r.digest);
    await digest(`🌙 While your quiet hours were on: ${held.length} alert${held.length === 1 ? "" : "s"}`, held);
    const live = rows.filter((r) => !r.digest);
    for (const n of live.slice(0, TG_PER_CHAT_PER_RUN)) {
      try {
        await sendTelegramAlert(n, chat);
        await done([n]);
      } catch (err) {
        await fail([n], err);
      }
    }
    const extra = live.slice(TG_PER_CHAT_PER_RUN);
    await digest(`+${extra.length} more alert${extra.length === 1 ? "" : "s"} just now`, extra);
  }

  if (sent || failed) log.info("Notifications delivered", { sent, failed });
  // Undeliverable after 1 day → failed.
  await query("UPDATE notifications SET status = 'failed', last_error = COALESCE(last_error, 'Expired') WHERE status = 'pending' AND created_at < now() - interval '1 day'");
  return { sent, failed };
}

/** One alert as its own Telegram message (structured card when available), threaded under an earlier alert when asked. */
async function sendTelegramAlert(n: PendingRow, chat: string) {
  const url = n.link ? `${env.appUrl}${n.link}` : env.appUrl;
  if (!n.meta) {
    await sendTelegram(chat, `*${escapeMarkdown(n.title)}*\n${escapeMarkdown(n.body)}\n${escapeMarkdown(url)}`);
    return;
  }
  const meta = await withLatestCheck(n.meta);
  const m = formatTelegramAlert(meta, url);
  const replyTo = meta.replyTo
    ? (
        await queryOne<{ tg_message_id: number }>(
          `SELECT tg_message_id FROM notifications WHERE user_id = $1 AND tg_chat_id = $2 AND meta->>'address' = $3 AND tg_message_id IS NOT NULL AND id <> $4
            ORDER BY created_at LIMIT 1`,
          [n.user_id, chat, meta.replyTo, n.id],
        )
      )?.tg_message_id
    : null;
  const messageId = await sendTelegramHtml(chat, m.text, m.buttons, replyTo ? Number(replyTo) : null);
  await query("UPDATE notifications SET meta = $2, tg_chat_id = $3, tg_message_id = $4 WHERE id = $1", [n.id, JSON.stringify(meta), chat, messageId]);
}
