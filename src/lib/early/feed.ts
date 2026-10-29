import { query } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { WATCH_MIN_SCORE } from "@/lib/wallets/smart-money";
import { classifyEarly, EARLY_MAX_AGE_HOURS, MIN_LIQUIDITY_USD, STALE_MINUTES, type EarlyClass, type EarlyResult } from "./signals";

export interface EarlyCoin extends EarlyResult {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  pool: string | null;
  /** The main DEX pool (where trades are read from). */
  pair: string | null;
  ageHours: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null };
  volumeH1: number | null;
  /** Smart wallets (score 60+, not bots) that bought in the last 24h. */
  smartWallets: number;
  updatedAt: Date;
}

interface Row {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  pool: string | null;
  pair: string | null;
  age_hours: number | null;
  price_usd: number | null;
  price_change_m5: number | null;
  price_change_h1: number | null;
  price_change_h6: number | null;
  volume_h1: number | null;
  volume_h6: number | null;
  buys_h1: number | null;
  sells_h1: number | null;
  buys_h6: number | null;
  sells_h6: number | null;
  liquidity_usd: number | null;
  liq_peak: number | null;
  market_cap: number | null;
  captured_at: Date;
  risk_level: string | null;
  launch_passed: boolean | null;
  dev_score: number | null;
  dev_launches: number | null;
  dev_sold: number | null;
  smart_wallets: number | null;
  smart_sol: number | null;
  buyers: number | null;
  buyer_trades: number | null;
  buyer_span: number | null;
  buyers_age: number | null;
}

/** Coins considered per refresh: the most active fresh ones. */
const SCAN = 300;
const CACHE_MS = 30_000;
let cache: { at: number; coins: EarlyCoin[] } | null = null;

/**
 * The Early Coins feed: fresh Solana coins (under EARLY_MAX_AGE_HOURS) with current market data, classified and
 * ranked by their signals (see ./signals). Shared by every user and the alert engine; cached CACHE_MS.
 */
export async function earlyFeed(): Promise<EarlyCoin[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.coins;
  const rows = await query<Row>(
    `WITH smart AS (
       SELECT x.token_address, count(DISTINCT x.wallet_id)::int AS n, sum((x.raw->>'sol')::numeric)::float AS sol
         FROM wallet_transactions x JOIN wallet_scores s ON s.wallet_id = x.wallet_id
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > now() - interval '24 hours'
          AND s.score >= $4 AND NOT s.bot_like
        GROUP BY x.token_address)
     SELECT t.id, t.chain, t.address, t.symbol, t.name, t.logo_url, lp.pool, mp.pair_address AS pair,
            (EXTRACT(EPOCH FROM (now() - t.pair_created_at)) / 3600)::float AS age_hours,
            snap.price_usd::float, snap.price_change_m5::float, snap.price_change_h1::float, snap.price_change_h6::float,
            snap.volume_h1::float, snap.volume_h6::float, snap.buys_h1, snap.sells_h1, snap.buys_h6, snap.sells_h6,
            snap.liquidity_usd::float, peak.liq::float AS liq_peak, COALESCE(snap.market_cap, snap.fdv)::float AS market_cap, snap.captured_at,
            sec.risk_level, lc.passed AS launch_passed, dp.score AS dev_score, dp.launches AS dev_launches,
            (SELECT sum(supply_pct)::float FROM dev_sells d WHERE d.mint = t.address) AS dev_sold,
            smart.n AS smart_wallets, smart.sol AS smart_sol,
            bs.buyers, bs.trades AS buyer_trades, bs.span_minutes AS buyer_span,
            (EXTRACT(EPOCH FROM (now() - bs.computed_at)) / 60)::float AS buyers_age
       FROM token_assets t
       JOIN LATERAL (SELECT * FROM market_snapshots m WHERE m.token_id = t.id ORDER BY m.captured_at DESC LIMIT 1) snap ON true
       LEFT JOIN market_pairs mp ON mp.id = snap.pair_id
       LEFT JOIN token_buyer_stats bs ON bs.chain = t.chain AND bs.address = t.address
       LEFT JOIN LATERAL (SELECT max(liquidity_usd) AS liq FROM market_snapshots m WHERE m.token_id = t.id AND m.captured_at > now() - interval '2 hours') peak ON true
       LEFT JOIN LATERAL (SELECT risk_level FROM token_security_checks c WHERE c.token_id = t.id AND c.status NOT IN ('unavailable', 'error') ORDER BY c.checked_at DESC LIMIT 1) sec ON true
       LEFT JOIN launch_checks lc ON lc.mint = t.address
       LEFT JOIN launchpad_tokens lp ON lp.mint = t.address
       LEFT JOIN dev_profiles dp ON dp.creator = lp.creator
       LEFT JOIN smart ON smart.token_address = t.address
      WHERE t.chain = 'solana' AND NOT t.is_spam AND t.is_demo = $1
        AND t.pair_created_at > now() - make_interval(hours => $2)
        AND snap.captured_at > now() - make_interval(mins => $3)
        AND snap.liquidity_usd >= ${MIN_LIQUIDITY_USD}
      ORDER BY snap.volume_h1 DESC NULLS LAST
      LIMIT ${SCAN}`,
    [env.demoMode, EARLY_MAX_AGE_HOURS, STALE_MINUTES, WATCH_MIN_SCORE],
  );
  const coins: EarlyCoin[] = [];
  for (const r of rows) {
    const res = classifyEarly({
      priceUsd: r.price_usd,
      change: { m5: r.price_change_m5, h1: r.price_change_h1, h6: r.price_change_h6 },
      volume: { h1: r.volume_h1, h6: r.volume_h6 },
      txns: { buysH1: r.buys_h1, sellsH1: r.sells_h1, buysH6: r.buys_h6, sellsH6: r.sells_h6 },
      liquidityUsd: r.liquidity_usd,
      liquidityPeakUsd: r.liq_peak,
      marketCapUsd: r.market_cap,
      ageHours: r.age_hours,
      contractRisk: r.risk_level,
      launchCheckPassed: r.launch_passed,
      devScore: r.dev_score,
      devLaunches: r.dev_launches,
      devSoldPct: r.dev_sold,
      smartWallets: r.smart_wallets ?? 0,
      smartSol: r.smart_sol ?? 0,
      dataAgeMinutes: (Date.now() - new Date(r.captured_at).getTime()) / 60_000,
      onchainData: integrations.helius,
      wallets: r.buyers !== null && r.buyer_trades !== null ? { buyers: r.buyers, trades: r.buyer_trades, spanMinutes: r.buyer_span, ageMinutes: r.buyers_age ?? Infinity } : null,
    });
    if (!res.cls) continue;
    coins.push({
      ...res,
      id: r.id,
      chain: r.chain,
      address: r.address,
      symbol: r.symbol,
      name: r.name,
      logoUrl: r.logo_url,
      pool: r.pool,
      pair: r.pair,
      ageHours: r.age_hours,
      priceUsd: r.price_usd,
      marketCapUsd: r.market_cap,
      liquidityUsd: r.liquidity_usd,
      change: { m5: r.price_change_m5, h1: r.price_change_h1, h6: r.price_change_h6 },
      volumeH1: r.volume_h1,
      smartWallets: r.smart_wallets ?? 0,
      updatedAt: r.captured_at,
    });
  }
  const order: Record<EarlyClass, number> = { building: 0, early: 1, high_risk: 2 };
  coins.sort((a, b) => order[a.cls!] - order[b.cls!] || b.rank - a.rank);
  cache = { at: Date.now(), coins };
  return coins;
}

/** For tests: forget the cached feed. */
export function resetEarlyFeedCache() {
  cache = null;
}
