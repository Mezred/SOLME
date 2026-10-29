import { CHAINS, isChainId, type ChainId } from "@/lib/chains";
import { query, queryOne, transaction, type Queryable } from "@/lib/db";
import { env } from "@/lib/env";
import { readableLabel } from "@/lib/format";
import { errorMessage, logger } from "@/lib/log";
import { dexscreener } from "@/lib/providers/dexscreener";
import { geckoterminal } from "@/lib/providers/geckoterminal";
import { goplus } from "@/lib/providers/goplus";
import type { Candle, DiscoveryCandidate, MarketPairData, SecurityReport } from "@/lib/providers/types";
import { scoreToken, type ScoringResult } from "@/lib/scoring/engine";
import { BULLISH_ELIGIBLE_SQL } from "@/lib/scoring/stored";
import { getSetting } from "@/lib/settings";
import { spamReason, worthStoring } from "./spam";

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
  errors: string[];
  /** 24h change of each chain's wrapped native asset (market-regime context). */
  regime?: Record<string, number | null>;
}

/** GoPlus answers one token per request at ~25 req/min, so checks are bounded per chain per cycle. */
const SECURITY_PER_CYCLE = 15;

// "launchpad" = organic traction on a bonding curve (see launchpadCandidates); ranked with trending.
const PRIORITY: Record<string, number> = { watchlist: 0, early: 1, launchpad: 2, trending: 2, new_pool: 3, profile: 4, boosted: 5 };
/** Every enabled chain gets at least this many discovery slots per cycle before the rest go by priority. */
const MIN_PER_CHAIN = 10;

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
      p.chain, p.tokenAddress, readableLabel(p.symbol, p.tokenAddress), readableLabel(p.name, p.tokenAddress), p.logoUrl, p.pairCreatedAt, Boolean(spam), spam, extra.isDemo ?? false,
      JSON.stringify({
        websites: p.websites.slice(0, 5),
        socials: p.socials.slice(0, 8),
        promoted: p.promoted,
        ...(extra.discoveryReason ? { discovery: extra.discoveryReason } : {}),
        // Original on-chain labels when they were unreadable (see readableLabel).
        ...(readableLabel(p.symbol, p.tokenAddress) !== p.symbol.trim() ? { original_symbol: p.symbol, original_name: p.name } : {}),
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
       volume_m5, volume_h1, volume_h6, volume_h24, liquidity_usd, market_cap, fdv, buys_m5, sells_m5, buys_h1, sells_h1, buys_h24, sells_h24, holder_count, is_demo,
       buys_h6, sells_h6)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
    [
      token.id, pair.id, p.source, p.priceUsd, p.priceChange.m5, p.priceChange.h1, p.priceChange.h6, p.priceChange.h24, p.priceChange.d7,
      p.volume.m5, p.volume.h1, p.volume.h6, p.volume.h24, p.liquidityUsd, p.marketCap, p.fdv,
      p.txns.m5?.buys ?? null, p.txns.m5?.sells ?? null, p.txns.h1?.buys ?? null, p.txns.h1?.sells ?? null,
      p.txns.h24?.buys ?? null, p.txns.h24?.sells ?? null, extra.holderCount ?? null, extra.isDemo ?? false,
      p.txns.h6?.buys ?? null, p.txns.h6?.sells ?? null,
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

/** Stores the latest score on the token (read by the screener, token pages and the pre-buy check). */
export async function saveScore(tokenId: string, result: ScoringResult, now: Date) {
  await query("UPDATE token_assets SET metadata = metadata || $2::jsonb WHERE id = $1", [
    tokenId,
    JSON.stringify({ last_score: { ai: result.aiScore, quality: result.qualityScore, momentum: result.momentumScore, risk: result.riskScore, confidence: result.confidenceScore, type: result.signalType, eligible: result.eligibility.eligible, at: now.toISOString() } }),
  ]);
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

/**
 * Picks this cycle's tokens. User-priority tokens (watchlists, open positions, eligible bullish coins) always go
 * first. Then each chain gets a guaranteed minimum (round-robin, its own priority order), so busy chains
 * cannot crowd out small ones; the remaining budget goes by priority across all chains, so busy chains
 * still get the larger share. `sorted` must already be priority-sorted.
 */
export function allocateCandidates(sorted: DiscoveryCandidate[], chains: ChainId[], max: number, minPerChain = MIN_PER_CHAIN): DiscoveryCandidate[] {
  const isPinned = (c: DiscoveryCandidate) => (PRIORITY[c.reason] ?? 9) <= PRIORITY.early;
  const out = sorted.filter(isPinned).slice(0, max);
  const taken = new Set(out);
  const floor = Math.min(minPerChain, Math.floor((max - out.length) / Math.max(1, chains.length)));
  const queues = chains.map((ch) => sorted.filter((c) => c.chain === ch && !isPinned(c)));
  const take = (c: DiscoveryCandidate) => {
    out.push(c);
    taken.add(c);
  };
  for (let i = 0; i < floor; i++) {
    for (const q of queues) if (i < q.length && out.length < max) take(q[i]);
  }
  for (const c of sorted) {
    if (out.length >= max) break;
    if (!taken.has(c)) take(c);
  }
  return out;
}

/** Launchpad tokens (pump.fun, LetsBonk) with organic traction: far along the curve, or just migrated. */
async function launchpadCandidates(chains: ChainId[]): Promise<DiscoveryCandidate[]> {
  const enabled = chains;
  if (!enabled.length) return [];
  const rows = await query<{ mint: string; chain: ChainId }>(
    `SELECT mint, chain FROM launchpad_tokens
      WHERE chain = ANY($1) AND source = 'stream' AND (
            (NOT complete AND migrated_at IS NULL AND progress >= 0.5 AND created_at > now() - interval '6 hours')
         OR ((complete OR migrated_at IS NOT NULL) AND created_at > now() - interval '24 hours'))
      ORDER BY COALESCE(migrated_at, updated_at) DESC LIMIT 30`,
    [enabled],
  );
  return rows.map((r) => ({ chain: r.chain, address: r.mint, reason: "launchpad" as const, source: "launchpad" }));
}

/** One centralized ingestion cycle shared by all users. */
export async function runIngestionCycle(): Promise<CycleStats> {
  const settings = await getSetting("ingestion");
  const scoring = await getSetting("scoring");
  const stats: CycleStats = {
    startedAt: new Date().toISOString(), candidates: 0, tokensFetched: 0, stored: 0, spam: 0,
    securityChecked: 0, scored: 0, errors: [],
  };
  if (!settings.enabled || env.demoMode) return stats;
  const chains = settings.chains.filter(isChainId);

  const found: DiscoveryCandidate[] = [...(await priorityTokens())];
  try {
    found.push(...(await launchpadCandidates(chains)));
  } catch (err) {
    stats.errors.push(`launchpad discovery: ${errorMessage(err)}`);
  }
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
  const candidates = allocateCandidates([...unique.values()], chains, settings.max_tokens_per_cycle);
  stats.candidates = candidates.length;

  const regime = await nativeRegime(chains);
  stats.regime = Object.fromEntries(regime);
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
      if (!worthStoring(p)) continue;
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

    // Security: refresh only when older than the TTL (1h for "unavailable" results), only for non-spam tokens
    // with tradable liquidity, and at most SECURITY_PER_CYCLE per chain — the rest carry over to the next cycle.
    const needSecurity: typeof stored = [];
    const neverChecked = new Set<string>();
    for (const s of stored) {
      if (s.spam || (s.p.liquidityUsd ?? 0) < scoring.thresholds.min_liquidity_usd) continue;
      const last = await latestSecurity(s.tokenId);
      const ttlMs = last?.status === "unavailable" ? 3_600_000 : settings.security_ttl_hours * 3_600_000;
      if (!last) neverChecked.add(s.tokenId);
      if (!last || now.getTime() - new Date(last.checked_at).getTime() > ttlMs) needSecurity.push(s);
    }
    // The budget is limited (GoPlus rate limits): check tokens traders are looking at first — eligible bullish
    // patterns — then tokens never checked, then by liquidity. An unverified contract blocks a pre-buy verdict.
    const bullish = new Set(
      needSecurity.length
        ? (await query<{ id: string }>(
            `SELECT t.id FROM token_assets t WHERE t.id = ANY($1) AND ${BULLISH_ELIGIBLE_SQL}
               AND (t.metadata->'last_score'->>'at')::timestamptz > now() - interval '25 hours'`,
            [needSecurity.map((s) => s.tokenId)],
          )).map((r) => r.id)
        : [],
    );
    const rank = (s: (typeof stored)[number]) => (bullish.has(s.tokenId) ? 2 : 0) + (neverChecked.has(s.tokenId) ? 1 : 0);
    needSecurity.sort((a, b) => rank(b) - rank(a) || (b.p.liquidityUsd ?? 0) - (a.p.liquidityUsd ?? 0)).splice(SECURITY_PER_CYCLE);
    if (needSecurity.length) {
      try {
        const reports = await goplus.check(chain, needSecurity.map((s) => s.p.tokenAddress), {
          excludeHolders: needSecurity.map((s) => s.p.pairAddress),
          pools: Object.fromEntries(needSecurity.map((s) => [s.p.tokenAddress, s.p.pairAddress])),
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
      await saveScore(s.tokenId, result, now);
    }
  }

  stats.finishedAt = new Date().toISOString();
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('ingestion_status', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(stats)],
  );
  log.info("Ingestion cycle complete", { ...stats, errors: stats.errors.length });
  return stats;
}

export async function pruneOldData() {
  const settings = await getSetting("ingestion");
  await query("DELETE FROM market_snapshots WHERE captured_at < now() - make_interval(days => $1)", [settings.snapshot_retention_days]);
  await query("DELETE FROM jobs WHERE status IN ('done', 'failed') AND created_at < now() - interval '2 days'");
  await query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
  await query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
  await query("DELETE FROM app_logs WHERE created_at < now() - interval '30 days'");
}
