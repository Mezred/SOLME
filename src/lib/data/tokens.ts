import { z } from "zod";
import { CHAIN_IDS, type ChainId } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import type { SecurityCheck } from "@/lib/providers/types";

export interface TokenRow {
  id: string;
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  pair_created_at: Date | null;
  is_demo: boolean;
  is_spam: boolean;
  spam_reason: string | null;
  metadata: {
    websites?: string[];
    socials?: { type: string; url: string }[];
    promoted?: boolean;
    discovery?: string;
    last_score?: { ai: number; quality: number | null; momentum: number | null; risk: number; confidence: number; type: string | null; eligible?: boolean; at: string };
  };
  first_seen_at: Date;
  // latest snapshot
  price_usd: number | null;
  price_change_m5: number | null;
  price_change_h1: number | null;
  price_change_h6: number | null;
  price_change_h24: number | null;
  price_change_d7: number | null;
  volume_h1: number | null;
  volume_h24: number | null;
  liquidity_usd: number | null;
  market_cap: number | null;
  fdv: number | null;
  buys_h1: number | null;
  sells_h1: number | null;
  buys_h24: number | null;
  sells_h24: number | null;
  captured_at: Date | null;
  security_risk: string | null;
  holder_count: number | null;
  /** Launchpad the coin started on (pump, bonk), when SOLME recorded its launch. */
  launchpad: string | null;
  /** DEX of the main pair (DexScreener dexId). */
  dex_id: string | null;
}

const csv = <T extends string>(allowed: readonly T[]) =>
  z.string().optional().transform((v) => (v ? v.split(",").filter((x): x is T => (allowed as readonly string[]).includes(x)) : []));
const optNum = z.coerce.number().finite().optional().catch(undefined);

/**
 * Range filters, DexScreener's set plus SOLME's own: each id gives a `min<Id>` and a `max<Id>` query parameter.
 * Names match the parameters saved templates and alerts already use (minVolume = 24h volume, maxAgeHours…).
 * `free`: available on every plan; the rest need advanced filters (Pro).
 */
export const RANGE_FILTERS = {
  Liquidity: { sql: "snap.liquidity_usd", free: true },
  Mcap: { sql: "COALESCE(snap.market_cap, snap.fdv)", free: true },
  Fdv: { sql: "snap.fdv", free: false },
  AgeHours: { sql: "(EXTRACT(EPOCH FROM (now() - t.pair_created_at)) / 3600)", free: true },
  Volume: { sql: "snap.volume_h24", free: true },
  VolumeH6: { sql: "snap.volume_h6", free: false },
  VolumeH1: { sql: "snap.volume_h1", free: false },
  VolumeM5: { sql: "snap.volume_m5", free: false },
  TxnsH24: { sql: "(snap.buys_h24 + snap.sells_h24)", free: true },
  TxnsH6: { sql: "(snap.buys_h6 + snap.sells_h6)", free: false },
  TxnsH1: { sql: "(snap.buys_h1 + snap.sells_h1)", free: false },
  TxnsM5: { sql: "(snap.buys_m5 + snap.sells_m5)", free: false },
  BuysH24: { sql: "snap.buys_h24", free: false },
  BuysH6: { sql: "snap.buys_h6", free: false },
  BuysH1: { sql: "snap.buys_h1", free: false },
  BuysM5: { sql: "snap.buys_m5", free: false },
  SellsH24: { sql: "snap.sells_h24", free: false },
  SellsH6: { sql: "snap.sells_h6", free: false },
  SellsH1: { sql: "snap.sells_h1", free: false },
  SellsM5: { sql: "snap.sells_m5", free: false },
  ChangeH24: { sql: "snap.price_change_h24", free: true },
  ChangeH6: { sql: "snap.price_change_h6", free: false },
  ChangeH1: { sql: "snap.price_change_h1", free: false },
  ChangeM5: { sql: "snap.price_change_m5", free: false },
  /** % of last-hour transactions that were buys. */
  BuyShare: { sql: "(snap.buys_h1::numeric / NULLIF(snap.buys_h1 + snap.sells_h1, 0) * 100)", free: false },
  /** Market cap ÷ liquidity (high = thin pool for the valuation, easy to dump). */
  McapLiq: { sql: "(COALESCE(snap.market_cap, snap.fdv) / NULLIF(snap.liquidity_usd, 0))", free: false },
  DevScore: { sql: "dp.score", free: false },
  Score: { sql: "(t.metadata->'last_score'->>'ai')::int", free: false },
} as const;
export type RangeId = keyof typeof RANGE_FILTERS;
const RANGE_IDS = Object.keys(RANGE_FILTERS) as RangeId[];
type RangeKey = `min${RangeId}` | `max${RangeId}`;
const rangeShape = Object.fromEntries(RANGE_IDS.flatMap((id) => [[`min${id}`, optNum], [`max${id}`, optNum]])) as Record<RangeKey, typeof optNum>;

/** DEX of the coin's main pair (DexScreener dexId). Bonding curves are listed as pumpfun / launchlab / meteoradbc. */
export const DEX_IDS = ["pumpswap", "raydium", "meteora", "orca", "pumpfun", "launchlab", "meteoradbc"] as const;

export const TOKEN_SORTS = ["score", "volume", "volume_h1", "liquidity", "change_m5", "change_h1", "change_h6", "change_h24", "mcap", "age", "volume_accel", "txns", "txns_h1", "updated"] as const;

export const tokenFilterSchema = z.object({
  chain: csv(CHAIN_IDS),
  q: z.string().trim().max(80).optional().catch(undefined),
  ...rangeShape,
  dex: csv(DEX_IDS),
  /** Launchpad origin; "none" = not a recorded launchpad coin. */
  launchpad: csv(["pump", "bonk", "none"] as const),
  /** Only coins with a website or socials on DexScreener (an enhanced token profile). */
  profile: z.enum(["1"]).optional().catch(undefined),
  /** Only coins with active paid DexScreener boosts. Promotion is not a sign of quality. */
  boosted: z.enum(["1"]).optional().catch(undefined),
  /** Contract OK (no high/critical findings); launchpad coins must also pass the full background check when they have one. */
  scamCheck: z.enum(["passed"]).optional().catch(undefined),
  risk: csv(["low", "medium", "high", "critical", "unknown"] as const),
  includeSpam: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(TOKEN_SORTS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(10).max(100).optional().catch(undefined),
});
export type TokenFilters = z.infer<typeof tokenFilterSchema>;

const TOKEN_SORT_SQL: Record<(typeof TOKEN_SORTS)[number], string> = {
  score: "(t.metadata->'last_score'->>'ai')::int",
  volume: "snap.volume_h24",
  volume_h1: "snap.volume_h1",
  liquidity: "snap.liquidity_usd",
  change_m5: "snap.price_change_m5",
  change_h1: "snap.price_change_h1",
  change_h6: "snap.price_change_h6",
  change_h24: "snap.price_change_h24",
  mcap: "COALESCE(snap.market_cap, snap.fdv)",
  age: "t.pair_created_at",
  volume_accel: "(snap.volume_h1 / NULLIF(snap.volume_h24 / 24, 0))",
  txns: "(snap.buys_h24 + snap.sells_h24)",
  txns_h1: "(snap.buys_h1 + snap.sells_h1)",
  updated: "snap.captured_at",
};

const TOKEN_SELECT = `
  t.id, t.chain, t.address, t.symbol, t.name, t.logo_url, t.pair_created_at, t.is_demo, t.is_spam, t.spam_reason, t.metadata, t.first_seen_at,
  snap.price_usd, snap.price_change_m5, snap.price_change_h1, snap.price_change_h6, snap.price_change_h24, snap.price_change_d7,
  snap.volume_h1, snap.volume_h24, snap.liquidity_usd, snap.market_cap, snap.fdv, snap.buys_h1, snap.sells_h1, snap.buys_h24, snap.sells_h24,
  snap.captured_at, sec.risk_level AS security_risk, sec.holder_count, lp.pool AS launchpad, mp.dex_id`;

const TOKEN_JOINS = `
  LEFT JOIN LATERAL (SELECT * FROM market_snapshots ms WHERE ms.token_id = t.id ORDER BY ms.captured_at DESC LIMIT 1) snap ON true
  LEFT JOIN LATERAL (SELECT risk_level, holder_count FROM token_security_checks sc WHERE sc.token_id = t.id ORDER BY sc.checked_at DESC LIMIT 1) sec ON true
  LEFT JOIN launchpad_tokens lp ON lp.mint = t.address
  LEFT JOIN dev_profiles dp ON dp.creator = lp.creator
  LEFT JOIN launch_checks lc ON lc.mint = t.address
  LEFT JOIN market_pairs mp ON mp.id = snap.pair_id`;

export async function listTokens(f: TokenFilters, allowedChains: ChainId[], opts: { advanced: boolean }) {
  const where: string[] = ["t.is_demo = $1", "snap.captured_at IS NOT NULL"];
  const params: unknown[] = [env.demoMode];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const restrictions: string[] = [];
  const chains = (f.chain.length ? f.chain : CHAIN_IDS).filter((c) => allowedChains.includes(c));
  where.push(`t.chain = ANY(${p(chains)})`);
  if (!f.includeSpam) where.push("NOT t.is_spam");
  if (f.q) {
    const like = p(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(t.symbol) LIKE ${like} OR lower(t.name) LIKE ${like} OR t.address = ${p(f.q)} OR lower(t.address) = ${p(f.q.toLowerCase())})`);
  }
  // Ranges: free ones always apply; advanced ones only on plans with advanced filters (the rest are reported).
  let locked = false;
  for (const id of RANGE_IDS) {
    const { sql, free } = RANGE_FILTERS[id];
    const lo = f[`min${id}`];
    const hi = f[`max${id}`];
    if (lo === undefined && hi === undefined) continue;
    if (!free && !opts.advanced) {
      locked = true;
      continue;
    }
    if (lo !== undefined) where.push(`${sql} >= ${p(lo)}`);
    if (hi !== undefined) where.push(`${sql} <= ${p(hi)}`);
  }
  if (f.dex.length) where.push(`mp.dex_id = ANY(${p(f.dex)})`);
  if (f.profile) where.push(`(jsonb_array_length(COALESCE(t.metadata->'websites', '[]'::jsonb)) > 0 OR jsonb_array_length(COALESCE(t.metadata->'socials', '[]'::jsonb)) > 0)`);
  if (f.boosted) where.push(`COALESCE((t.metadata->>'promoted')::boolean, false)`);
  if (f.launchpad.length) {
    const pools = f.launchpad.filter((x) => x !== "none");
    const parts = [...(pools.length ? [`lp.pool = ANY(${p(pools)})`] : []), ...(f.launchpad.includes("none") ? ["lp.mint IS NULL"] : [])];
    where.push(`(${parts.join(" OR ")})`);
  }
  if (f.scamCheck || f.risk.length) {
    if (!opts.advanced) locked = true;
    else {
      if (f.risk.length) where.push(`COALESCE(sec.risk_level, 'unknown') = ANY(${p(f.risk)})`);
      if (f.scamCheck) where.push(`sec.risk_level IN ('low', 'medium') AND COALESCE(lc.passed, true)`);
    }
  }
  if (locked) restrictions.push("Some filters (6h/1h/5m, buys/sells, FDV, buy share, liquidity ratio, dev score, scam check, risk) require Pro; they were not applied.");

  const pageSize = f.pageSize ?? 25;
  const page = f.page ?? 1;
  const sort = TOKEN_SORT_SQL[f.sort ?? "volume"];
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const from = `FROM token_assets t ${TOKEN_JOINS} WHERE ${where.join(" AND ")}`;
  const [c] = await query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params);
  const rows = await query<TokenRow>(
    `SELECT ${TOKEN_SELECT} ${from} ORDER BY ${sort} ${dir} NULLS LAST, t.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: c.n, page, pageSize, restrictions };
}

/** What the Screener covers: every tracked pair with market data, per chain (spam excluded), the same set it filters. Cached for a minute. */
export async function screenerCoverage(chains: ChainId[]): Promise<{ total: number; byChain: { chain: ChainId; n: number }[] }> {
  const g = globalThis as unknown as { __nxCoverage?: { at: number; key: string; v: { total: number; byChain: { chain: ChainId; n: number }[] } } };
  const key = chains.join(",");
  if (g.__nxCoverage && g.__nxCoverage.key === key && Date.now() - g.__nxCoverage.at < 60_000) return g.__nxCoverage.v;
  const rows = await query<{ chain: ChainId; n: number }>(
    `SELECT t.chain, count(*)::int AS n FROM token_assets t
      WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2)
        AND EXISTS (SELECT 1 FROM market_snapshots m WHERE m.token_id = t.id)
      GROUP BY t.chain ORDER BY n DESC`,
    [env.demoMode, chains],
  );
  const v = { total: rows.reduce((s, r) => s + r.n, 0), byChain: rows };
  g.__nxCoverage = { at: Date.now(), key, v };
  return v;
}

export async function getToken(id: string): Promise<TokenRow | null> {
  return queryOne<TokenRow>(`SELECT ${TOKEN_SELECT} FROM token_assets t ${TOKEN_JOINS} WHERE t.id = $1`, [id]);
}

export async function getTokenByAddress(chain: ChainId, address: string) {
  return queryOne<{ id: string }>("SELECT id FROM token_assets WHERE chain = $1 AND address = $2", [chain, address]);
}

export async function getTokenPairs(tokenId: string) {
  return query<{ id: string; pair_address: string; dex_id: string | null; quote_symbol: string | null; url: string | null; liquidity_usd: number | null; is_primary: boolean; pair_created_at: Date | null }>(
    "SELECT id, pair_address, dex_id, quote_symbol, url, liquidity_usd, is_primary, pair_created_at FROM market_pairs WHERE token_id = $1 ORDER BY is_primary DESC, liquidity_usd DESC NULLS LAST",
    [tokenId],
  );
}

export interface SecurityRow {
  id: string;
  provider: string;
  checked_at: Date;
  status: string;
  risk_level: string;
  checks: SecurityCheck[];
  unavailable_checks: string[];
  limitations: string;
  holder_count: number | null;
  top10_holder_pct: number | null;
  is_demo: boolean;
}

export async function getLatestSecurity(tokenId: string): Promise<SecurityRow | null> {
  return queryOne<SecurityRow>(
    `SELECT id, provider, checked_at, status, risk_level, checks, unavailable_checks, limitations, holder_count, top10_holder_pct, is_demo
       FROM token_security_checks WHERE token_id = $1 ORDER BY checked_at DESC LIMIT 1`,
    [tokenId],
  );
}

/** Price history from our own snapshots (used for sparklines and when OHLCV is unavailable). */
export async function getSnapshotSeries(tokenId: string, hours = 24) {
  return query<{ t: Date; price: number | null; liquidity: number | null; volume_h1: number | null }>(
    `SELECT captured_at AS t, price_usd AS price, liquidity_usd AS liquidity, volume_h1 FROM market_snapshots
      WHERE token_id = $1 AND captured_at > now() - make_interval(hours => $2) ORDER BY captured_at`,
    [tokenId, hours],
  );
}

export async function newLaunches(allowedChains: ChainId[], maxAgeHours = 72, limit = 60) {
  return query<TokenRow>(
    `SELECT ${TOKEN_SELECT} FROM token_assets t ${TOKEN_JOINS}
      WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) AND t.pair_created_at > now() - make_interval(hours => $3)
        AND snap.captured_at > now() - interval '6 hours'
      ORDER BY t.pair_created_at DESC LIMIT $4`,
    [env.demoMode, allowedChains, maxAgeHours, limit],
  );
}

export async function trendingTokens(allowedChains: ChainId[], by: "score" | "volume_accel" | "change_h1", limit = 12) {
  const order = by === "score" ? TOKEN_SORT_SQL.score : by === "volume_accel" ? TOKEN_SORT_SQL.volume_accel : TOKEN_SORT_SQL.change_h1;
  return query<TokenRow>(
    `SELECT ${TOKEN_SELECT} FROM token_assets t ${TOKEN_JOINS}
      WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) AND snap.captured_at > now() - interval '2 hours'
        AND snap.liquidity_usd >= 25000 AND snap.volume_h24 >= 10000
      ORDER BY ${order} DESC NULLS LAST LIMIT $3`,
    [env.demoMode, allowedChains, limit],
  );
}

export async function searchTokens(q: string, allowedChains: ChainId[], limit = 8) {
  const like = `%${q.toLowerCase()}%`;
  return query<{ id: string; chain: ChainId; symbol: string; name: string; address: string; logo_url: string | null; is_demo: boolean }>(
    `SELECT id, chain, symbol, name, address, logo_url, is_demo FROM token_assets
      WHERE is_demo = $1 AND chain = ANY($2) AND (lower(symbol) LIKE $3 OR lower(name) LIKE $3 OR address = $4 OR address = lower($4))
      ORDER BY (lower(symbol) = lower($4)) DESC, updated_at DESC LIMIT $5`,
    [env.demoMode, allowedChains, like, q, limit],
  );
}

export async function lastIngestion() {
  return queryOne<{ value: { finishedAt?: string; startedAt: string; stored: number; candidates: number; securityChecked: number; spam: number; errors: string[]; regime?: Record<string, number | null> } }>(
    "SELECT value FROM app_settings WHERE key = 'ingestion_status'",
  );
}

export async function latestSnapshotTime() {
  const r = await queryOne<{ at: Date | null }>("SELECT max(captured_at) AS at FROM market_snapshots WHERE is_demo = $1", [env.demoMode]);
  return r?.at ?? null;
}
