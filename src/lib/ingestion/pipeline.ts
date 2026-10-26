import { CHAINS, isChainId, type ChainId } from "@/lib/chains";
import { query, queryOne, transaction, type Queryable } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { dexscreener } from "@/lib/providers/dexscreener";
import { geckoterminal } from "@/lib/providers/geckoterminal";
import { goplus } from "@/lib/providers/goplus";
import type { Candle, DiscoveryCandidate, MarketPairData, SecurityReport } from "@/lib/providers/types";
import { scoreToken, type ScoringResult } from "@/lib/scoring/engine";
import { getSetting } from "@/lib/settings";
import { MIN_STORE_LIQUIDITY_USD, spamReason } from "./spam";

const log = logger("ingestion");

export interface CycleStats {
  startedAt: string;
  finishedAt?: string;
  candidates: number;
  tokensFetched: number;
  stored: number;
  spam: number;
  securityChecked: number;
  scored: number;
  signalsCreated: number;
  errors: string[];
}

const PRIORITY: Record<string, number> = { watchlist: 0, active_signal: 1, trending: 2, new_pool: 3, profile: 4, boosted: 5 };

/** Upserts token, pair and a fresh snapshot. Returns ids. */
export async function storeMarketData(
  tx: Queryable,
  p: MarketPairData,
  spam: string | null,
  extra: { discoveryReason?: string; isDemo?: boolean; holderCount?: number | null } = {},
): Promise<{ tokenId: string; pairId: string; snapshotId: number }> {
  const [token] = await tx.query<{ id: string }>(
    `INSERT INTO token_assets (chain, address, symbol, name, logo_url, pair_created_at, is_spam, spam_reason, is_demo, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (chain, address) DO UPDATE SET
       symbol = EXCLUDED.symbol, name = EXCLUDED.name,
       logo_url = COALESCE(EXCLUDED.logo_url, token_assets.logo_url),
       pair_created_at = LEAST(COALESCE(token_assets.pair_created_at, EXCLUDED.pair_created_at), COALESCE(EXCLUDED.pair_created_at, token_assets.pair_created_at)),
       is_spam = EXCLUDED.is_spam, spam_reason = EXCLUDED.spam_reason,
       metadata = token_assets.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      p.chain, p.tokenAddress, p.symbol, p.name, p.logoUrl, p.pairCreatedAt, Boolean(spam), spam, extra.isDemo ?? false,
      JSON.stringify({
        websites: p.websites.slice(0, 5),
        socials: p.socials.slice(0, 8),
        promoted: p.promoted,
        ...(extra.discoveryReason ? { discovery: extra.discoveryReason } : {}),
      }),
    ],
  );
  await tx.query("UPDATE market_pairs SET is_primary = false WHERE token_id = $1 AND pair_address <> $2", [token.id, p.pairAddress]);
  const [pair] = await tx.query<{ id: string }>(
    `INSERT INTO market_pairs (token_id, chain, pair_address, dex_id, quote_symbol, quote_address, url, pair_created_at, liquidity_usd, is_primary, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
     ON CONFLICT (chain, pair_address) DO UPDATE SET liquidity_usd = EXCLUDED.liquidity_usd, is_primary = true, updated_at = now()
     RETURNING id`,
    [token.id, p.chain, p.pairAddress, p.dexId, p.quoteSymbol, p.quoteAddress, p.url, p.pairCreatedAt, p.liquidityUsd],
  );
  const [snap] = await tx.query<{ id: number }>(
    `INSERT INTO market_snapshots (token_id, pair_id, source, price_usd, price_change_m5, price_change_h1, price_change_h6, price_change_h24, price_change_d7,
       volume_m5, volume_h1, volume_h6, volume_h24, liquidity_usd, market_cap, fdv, buys_m5, sells_m5, buys_h1, sells_h1, buys_h24, sells_h24, holder_count, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
    [
      token.id, pair.id, p.source, p.priceUsd, p.priceChange.m5, p.priceChange.h1, p.priceChange.h6, p.priceChange.h24, p.priceChange.d7,
      p.volume.m5, p.volume.h1, p.volume.h6, p.volume.h24, p.liquidityUsd, p.marketCap, p.fdv,
      p.txns.m5?.buys ?? null, p.txns.m5?.sells ?? null, p.txns.h1?.buys ?? null, p.txns.h1?.sells ?? null,
      p.txns.h24?.buys ?? null, p.txns.h24?.sells ?? null, extra.holderCount ?? null, extra.isDemo ?? false,
    ],
  );
  return { tokenId: token.id, pairId: pair.id, snapshotId: snap.id };
}

export async function storeSecurity(tokenId: string, r: SecurityReport, isDemo = false) {
  await query(
    `INSERT INTO token_security_checks (token_id, provider, checked_at, status, risk_level, checks, unavailable_checks, limitations, holder_count, top10_holder_pct, raw, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [tokenId, r.provider, r.checkedAt, r.status, r.riskLevel, JSON.stringify(r.checks), r.unavailable, r.limitations,
      r.holderCount, r.top10HolderPct, r.raw ? JSON.stringify(r.raw) : null, isDemo],
  );
}

interface StoredSecurity {
  status: SecurityReport["status"];
  risk_level: SecurityReport["riskLevel"];
  checks: SecurityReport["checks"];
  checked_at: Date;
  holder_count: number | null;
  top10_holder_pct: number | null;
}

export async function latestSecurity(tokenId: string): Promise<StoredSecurity | null> {
  return queryOne<StoredSecurity>(
    `SELECT status, risk_level, checks, checked_at, holder_count, top10_holder_pct
       FROM token_security_checks WHERE token_id = $1 ORDER BY checked_at DESC LIMIT 1`,
    [tokenId],
  );
}

/** Counts buys/sells in the last 24h by wallets with a documented (non-user) classification. */
async function smartMoneyActivity(chain: ChainId, address: string) {
  const row = await queryOne<{ buyers: number; sellers: number; tracked: number }>(
    `SELECT
       count(DISTINCT t.wallet_id) FILTER (WHERE t.direction IN ('buy', 'transfer_in'))::int AS buyers,
       count(DISTINCT t.wallet_id) FILTER (WHERE t.direction IN ('sell', 'transfer_out'))::int AS sellers,
       (SELECT count(*)::int FROM wallet_profiles w WHERE w.chain = $1 AND w.classification IN ('whale', 'fund', 'smart_money')) AS tracked
     FROM wallet_transactions t JOIN wallet_profiles w ON w.id = t.wallet_id
     WHERE t.chain = $1 AND t.token_address = $2 AND t.block_time > now() - interval '24 hours'
       AND w.classification IN ('whale', 'fund', 'smart_money')`,
    [chain, address],
  );
  if (!row || row.tracked === 0) return null; // no documented wallets → factor excluded, not zero
  return { labeledBuyers: row.buyers, labeledSellers: row.sellers };
}

/** Persists a signal unless an equivalent one already exists in the dedup window. */
export async function maybeCreateSignal(
  tokenId: string,
  chain: ChainId,
  snapshotId: number,
  price: number | null,
  result: ScoringResult,
  opts: { dedupHours: number; rescoreDelta: number; ttlHours: number; isDemo?: boolean; now?: Date },
): Promise<string | null> {
  if (!result.eligibility.eligible || !result.signalType) return null;
  const now = opts.now ?? new Date();
  const prev = await queryOne<{ ai_score: number }>(
    `SELECT ai_score FROM signals WHERE token_id = $1 AND signal_type = $2 AND created_at > $3::timestamptz - make_interval(hours => $4)
     ORDER BY created_at DESC LIMIT 1`,
    [tokenId, result.signalType, now, opts.dedupHours],
  );
  if (prev && result.aiScore - prev.ai_score < opts.rescoreDelta) return null;

  const bucket = Math.floor(now.getTime() / (opts.dedupHours * 3_600_000));
  const dedupKey = `${tokenId}:${result.signalType}:${bucket}${prev ? `:r${result.aiScore}` : ""}`;
  return transaction(async (tx) => {
    const s = result.scenario;
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO signals (token_id, chain, snapshot_id, signal_type, strength, ai_score, quality_score, momentum_score, risk_score, confidence_score,
         price_at_signal, entry_low, entry_high, invalidation, stop_loss, take_profits, rationale, risk_flags, missing_data, scoring_version,
         dedup_key, is_demo, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, $23::timestamptz + make_interval(hours => $24))
       ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
      [
        tokenId, chain, snapshotId, result.signalType, result.strength, result.aiScore, result.qualityScore, result.momentumScore,
        result.riskScore, result.confidenceScore, price, s?.entryLow ?? null, s?.entryHigh ?? null, s?.invalidation ?? null,
        s?.stopLoss ?? null, s ? JSON.stringify(s.takeProfits) : null, result.rationale, result.riskFlags, result.missingData,
        result.version, dedupKey, opts.isDemo ?? false, now, opts.ttlHours,
      ],
    );
    if (!row) return null;
    for (const f of result.factors) {
      await tx.query(
        `INSERT INTO signal_factors (signal_id, factor_key, category, score, weight, evidence, reason, missing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, f.key, f.category, f.score, f.weight, JSON.stringify(f.evidence), f.reason, f.missing],
      );
    }
    return row.id;
  });
}

async function nativeRegime(chains: ChainId[]): Promise<Map<ChainId, number | null>> {
  const out = new Map<ChainId, number | null>();
  for (const c of chains) {
    const [p] = await dexscreener.getTokens(c, [CHAINS[c].wrappedNative]).catch(() => []);
    out.set(c, p?.priceChange.h24 ?? null);
  }
  return out;
}

/** Tokens users care about stay fresh even if they fall off trending lists. */
async function priorityTokens(): Promise<DiscoveryCandidate[]> {
  const rows = await query<{ chain: string; address: string; reason: string }>(
    `SELECT DISTINCT t.chain, t.address, 'watchlist' AS reason FROM watchlist_items wi JOIN token_assets t ON t.id = wi.token_id WHERE NOT t.is_demo
     UNION
     SELECT DISTINCT t.chain, t.address, 'active_signal' FROM signals s JOIN token_assets t ON t.id = s.token_id
      WHERE s.created_at > now() - interval '25 hours' AND NOT s.is_demo
     UNION
     SELECT DISTINCT t.chain, t.address, 'watchlist' FROM positions p JOIN token_assets t ON t.id = p.token_id WHERE p.status = 'open' AND NOT t.is_demo
     LIMIT 300`,
  );
  return rows.filter((r) => isChainId(r.chain)).map((r) => ({
    chain: r.chain as ChainId,
    address: r.address,
    reason: r.reason as DiscoveryCandidate["reason"],
    source: "internal",
  }));
}

/** One centralized ingestion cycle shared by all users. */
export async function runIngestionCycle(): Promise<CycleStats> {
  const settings = await getSetting("ingestion");
  const scoring = await getSetting("scoring");
  const stats: CycleStats = {
    startedAt: new Date().toISOString(), candidates: 0, tokensFetched: 0, stored: 0, spam: 0,
    securityChecked: 0, scored: 0, signalsCreated: 0, errors: [],
  };
  if (!settings.enabled || env.demoMode) return stats;
  const chains = settings.chains.filter(isChainId);

  const found: DiscoveryCandidate[] = [...(await priorityTokens())];
  for (const p of [dexscreener, geckoterminal]) {
    try {
      found.push(...(await p.discover(chains)));
    } catch (err) {
      stats.errors.push(`${p.name} discovery: ${errorMessage(err)}`);
    }
  }
  const unique = new Map<string, DiscoveryCandidate>();
  for (const c of found.sort((a, b) => (PRIORITY[a.reason] ?? 9) - (PRIORITY[b.reason] ?? 9))) {
    const key = `${c.chain}:${c.address}`;
    if (!unique.has(key) && c.address !== CHAINS[c.chain].wrappedNative) unique.set(key, c);
  }
  const candidates = [...unique.values()].slice(0, settings.max_tokens_per_cycle);
  stats.candidates = candidates.length;

  const regime = await nativeRegime(chains);
  const now = new Date();

  for (const chain of chains) {
    const list = candidates.filter((c) => c.chain === chain);
    if (!list.length) continue;
    let pairs: MarketPairData[] = [];
    try {
      pairs = await dexscreener.getTokens(chain, list.map((c) => c.address));
    } catch (err) {
      stats.errors.push(`dexscreener ${chain}: ${errorMessage(err)}`);
      continue;
    }
    stats.tokensFetched += pairs.length;
    const reasonOf = new Map(list.map((c) => [c.address, c.reason]));

    const stored: { p: MarketPairData; tokenId: string; snapshotId: number; spam: string | null }[] = [];
    for (const p of pairs) {
      if ((p.liquidityUsd ?? 0) < MIN_STORE_LIQUIDITY_USD) continue;
      const spam = spamReason(p);
      if (spam) stats.spam++;
      try {
        const ids = await transaction((tx) => storeMarketData(tx, p, spam, { discoveryReason: reasonOf.get(p.tokenAddress) }));
        stored.push({ p, tokenId: ids.tokenId, snapshotId: ids.snapshotId, spam });
        stats.stored++;
      } catch (err) {
        stats.errors.push(`store ${p.symbol}: ${errorMessage(err)}`);
      }
    }

    // Security: refresh only when older than the TTL, and only for non-spam tokens with tradable liquidity.
    const needSecurity: typeof stored = [];
    for (const s of stored) {
      if (s.spam || (s.p.liquidityUsd ?? 0) < scoring.thresholds.min_liquidity_usd) continue;
      const last = await latestSecurity(s.tokenId);
      if (!last || now.getTime() - new Date(last.checked_at).getTime() > settings.security_ttl_hours * 3_600_000) needSecurity.push(s);
    }
    if (needSecurity.length) {
      try {
        const reports = await goplus.check(chain, needSecurity.map((s) => s.p.tokenAddress), {
          excludeHolders: needSecurity.map((s) => s.p.pairAddress),
        });
        for (const s of needSecurity) {
          const r = reports.get(s.p.tokenAddress);
          if (r) {
            await storeSecurity(s.tokenId, r);
            stats.securityChecked++;
          }
        }
      } catch (err) {
        stats.errors.push(`goplus ${chain}: ${errorMessage(err)}`);
      }
    }

    // Score. Candles are fetched only for tokens that already pass the publication pre-checks (to respect rate limits).
    let candleBudget = 3;
    for (const s of stored) {
      if (s.spam) continue;
      const sec = await latestSecurity(s.tokenId);
      const base = {
        now,
        capturedAt: now,
        market: { ...s.p, txns: { h1: s.p.txns.h1, h24: s.p.txns.h24 } },
        security: sec ? { status: sec.status, riskLevel: sec.risk_level, checks: sec.checks, checkedAt: new Date(sec.checked_at) } : null,
        holders: sec ? { count: sec.holder_count, top10Pct: sec.top10_holder_pct } : null,
        smartMoney: await smartMoneyActivity(chain, s.p.tokenAddress),
        regime: { nativeChangeH24: regime.get(chain) ?? null },
        candles: null as Candle[] | null,
      };
      let result = scoreToken(base, scoring);
      if (result.eligibility.eligible && candleBudget > 0 && ["momentum", "accumulation", "breakout_watch"].includes(result.signalType ?? "")) {
        candleBudget--;
        try {
          base.candles = await geckoterminal.getCandles(chain, s.p.pairAddress, "15m", 96);
          result = scoreToken(base, scoring);
        } catch (err) {
          stats.errors.push(`candles ${s.p.symbol}: ${errorMessage(err)}`);
        }
      }
      stats.scored++;
      const signalId = await maybeCreateSignal(s.tokenId, chain, s.snapshotId, s.p.priceUsd, result, {
        dedupHours: scoring.thresholds.dedup_hours,
        rescoreDelta: scoring.thresholds.rescore_delta,
        ttlHours: scoring.thresholds.signal_ttl_hours,
      });
      if (signalId) stats.signalsCreated++;
      await query(
        `UPDATE token_assets SET metadata = metadata || $2 WHERE id = $1`,
        [s.tokenId, JSON.stringify({ last_score: { ai: result.aiScore, quality: result.qualityScore, momentum: result.momentumScore, risk: result.riskScore, confidence: result.confidenceScore, type: result.signalType, at: now.toISOString() } })],
      );
    }
  }

  await query("UPDATE signals SET status = 'expired' WHERE status = 'active' AND expires_at < now()");
  stats.finishedAt = new Date().toISOString();
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('ingestion_status', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(stats)],
  );
  log.info("Ingestion cycle complete", { ...stats, errors: stats.errors.length });
  return stats;
}

/** Fills signal_history from snapshots observed after each signal — outcomes are measured, never estimated. */
export async function trackSignalOutcomes() {
  const open = await query<{ id: string; token_id: string; created_at: Date; price_at_signal: number | null; invalidation: number | null; take_profits: { price: number }[] | null }>(
    `SELECT s.id, s.token_id, s.created_at, s.price_at_signal, s.invalidation, s.take_profits
       FROM signals s LEFT JOIN signal_history h ON h.signal_id = s.id
      WHERE s.price_at_signal IS NOT NULL AND (h.signal_id IS NULL OR NOT h.is_final)
        AND s.created_at > now() - interval '3 days'
      LIMIT 500`,
  );
  for (const s of open) {
    const at = (hours: number) =>
      queryOne<{ price_usd: number }>(
        `SELECT price_usd FROM market_snapshots WHERE token_id = $1 AND captured_at BETWEEN $2::timestamptz + make_interval(hours => $3) AND $2::timestamptz + make_interval(hours => $3, mins => 45)
         ORDER BY captured_at LIMIT 1`,
        [s.token_id, s.created_at, hours],
      );
    const [p1, p6, p24] = await Promise.all([at(1), at(6), at(24)]);
    const range = await queryOne<{ max: number | null; min: number | null }>(
      `SELECT max(price_usd) AS max, min(price_usd) AS min FROM market_snapshots
        WHERE token_id = $1 AND captured_at > $2 AND captured_at <= $2::timestamptz + interval '24 hours'`,
      [s.token_id, s.created_at],
    );
    const ret = (p: { price_usd: number } | null) => (p && s.price_at_signal ? ((p.price_usd - s.price_at_signal) / s.price_at_signal) * 100 : null);
    const tp1 = s.take_profits?.[0]?.price ?? null;
    const final = Date.now() - new Date(s.created_at).getTime() > 25 * 3_600_000;
    await query(
      `INSERT INTO signal_history (signal_id, price_1h, price_6h, price_24h, return_1h, return_6h, return_24h, max_price, min_price, hit_take_profit, hit_invalidation, is_final, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (signal_id) DO UPDATE SET price_1h = EXCLUDED.price_1h, price_6h = EXCLUDED.price_6h, price_24h = EXCLUDED.price_24h,
         return_1h = EXCLUDED.return_1h, return_6h = EXCLUDED.return_6h, return_24h = EXCLUDED.return_24h, max_price = EXCLUDED.max_price,
         min_price = EXCLUDED.min_price, hit_take_profit = EXCLUDED.hit_take_profit, hit_invalidation = EXCLUDED.hit_invalidation,
         is_final = EXCLUDED.is_final, evaluated_at = now()`,
      [s.id, p1?.price_usd ?? null, p6?.price_usd ?? null, p24?.price_usd ?? null, ret(p1), ret(p6), ret(p24), range?.max ?? null, range?.min ?? null,
        tp1 !== null && range?.max != null ? range.max >= tp1 : null,
        s.invalidation !== null && range?.min != null ? range.min <= s.invalidation : null, final],
    );
    if (s.invalidation !== null && range?.min != null && range.min <= s.invalidation) {
      await query("UPDATE signals SET status = 'invalidated' WHERE id = $1 AND status = 'active'", [s.id]);
    }
  }
  return open.length;
}

export async function pruneOldData() {
  const settings = await getSetting("ingestion");
  await query("DELETE FROM market_snapshots WHERE captured_at < now() - make_interval(days => $1)", [settings.snapshot_retention_days]);
  await query("DELETE FROM jobs WHERE status IN ('done', 'failed') AND created_at < now() - interval '2 days'");
  await query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
  await query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
  await query("DELETE FROM app_logs WHERE created_at < now() - interval '30 days'");
}
