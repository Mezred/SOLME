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
    last_score?: { ai: number; quality: number | null; momentum: number | null; risk: number; confidence: number; type: string | null; at: string };
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
}

const csv = <T extends string>(allowed: readonly T[]) =>
  z.string().optional().transform((v) => (v ? v.split(",").filter((x): x is T => (allowed as readonly string[]).includes(x)) : []));
const optNum = z.coerce.number().finite().optional().catch(undefined);

export const TOKEN_SORTS = ["score", "volume", "liquidity", "change_h1", "change_h24", "mcap", "age", "volume_accel", "updated"] as const;

export const tokenFilterSchema = z.object({
  chain: csv(CHAIN_IDS),
  q: z.string().trim().max(80).optional().catch(undefined),
  minScore: optNum,
  minLiquidity: optNum,
  minVolume: optNum,
  minMcap: optNum,
  maxMcap: optNum,
  maxAgeHours: optNum,
  minAgeHours: optNum,
  minChangeH1: optNum,
  maxChangeH1: optNum,
  minChangeH24: optNum,
  maxChangeH24: optNum,
  minBuyShare: optNum,
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
  liquidity: "snap.liquidity_usd",
  change_h1: "snap.price_change_h1",
  change_h24: "snap.price_change_h24",
  mcap: "COALESCE(snap.market_cap, snap.fdv)",
  age: "t.pair_created_at",
  volume_accel: "(snap.volume_h1 / NULLIF(snap.volume_h24 / 24, 0))",
  updated: "snap.captured_at",
};

const TOKEN_SELECT = `
  t.id, t.chain, t.address, t.symbol, t.name, t.logo_url, t.pair_created_at, t.is_demo, t.is_spam, t.spam_reason, t.metadata, t.first_seen_at,
  snap.price_usd, snap.price_change_m5, snap.price_change_h1, snap.price_change_h6, snap.price_change_h24, snap.price_change_d7,
  snap.volume_h1, snap.volume_h24, snap.liquidity_usd, snap.market_cap, snap.fdv, snap.buys_h1, snap.sells_h1, snap.buys_h24, snap.sells_h24,
  snap.captured_at, sec.risk_level AS security_risk, sec.holder_count`;

const TOKEN_JOINS = `
  LEFT JOIN LATERAL (SELECT * FROM market_snapshots ms WHERE ms.token_id = t.id ORDER BY ms.captured_at DESC LIMIT 1) snap ON true
  LEFT JOIN LATERAL (SELECT risk_level, holder_count FROM token_security_checks sc WHERE sc.token_id = t.id ORDER BY sc.checked_at DESC LIMIT 1) sec ON true`;

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
  if (f.minLiquidity !== undefined) where.push(`snap.liquidity_usd >= ${p(f.minLiquidity)}`);
  if (f.maxAgeHours !== undefined) where.push(`t.pair_created_at >= now() - make_interval(hours => ${p(f.maxAgeHours)})`);
  if (f.minVolume !== undefined) where.push(`snap.volume_h24 >= ${p(f.minVolume)}`);

  const adv = [f.minScore, f.minMcap, f.maxMcap, f.minAgeHours, f.minChangeH1, f.maxChangeH1, f.minChangeH24, f.maxChangeH24, f.minBuyShare].some((x) => x !== undefined) || f.risk.length > 0;
  if (adv && !opts.advanced) restrictions.push("Score, market cap, price-change, buy-share and risk filters require Pro.");
  else {
    if (f.minScore !== undefined) where.push(`(t.metadata->'last_score'->>'ai')::int >= ${p(f.minScore)}`);
    if (f.minMcap !== undefined) where.push(`COALESCE(snap.market_cap, snap.fdv) >= ${p(f.minMcap)}`);
    if (f.maxMcap !== undefined) where.push(`COALESCE(snap.market_cap, snap.fdv) <= ${p(f.maxMcap)}`);
    if (f.minAgeHours !== undefined) where.push(`t.pair_created_at <= now() - make_interval(hours => ${p(f.minAgeHours)})`);
    if (f.minChangeH1 !== undefined) where.push(`snap.price_change_h1 >= ${p(f.minChangeH1)}`);
    if (f.maxChangeH1 !== undefined) where.push(`snap.price_change_h1 <= ${p(f.maxChangeH1)}`);
    if (f.minChangeH24 !== undefined) where.push(`snap.price_change_h24 >= ${p(f.minChangeH24)}`);
    if (f.maxChangeH24 !== undefined) where.push(`snap.price_change_h24 <= ${p(f.maxChangeH24)}`);
    if (f.minBuyShare !== undefined) where.push(`snap.buys_h1::numeric / NULLIF(snap.buys_h1 + snap.sells_h1, 0) * 100 >= ${p(f.minBuyShare)}`);
    if (f.risk.length) where.push(`COALESCE(sec.risk_level, 'unknown') = ANY(${p(f.risk)})`);
  }

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

export async function getTokenSignals(tokenId: string, limit = 20) {
  return query<{ id: string; signal_type: string; strength: string; ai_score: number; confidence_score: number; created_at: Date; status: string; price_at_signal: number | null; return_24h: number | null }>(
    `SELECT s.id, s.signal_type, s.strength, s.ai_score, s.confidence_score, s.created_at, s.status, s.price_at_signal, h.return_24h
       FROM signals s LEFT JOIN signal_history h ON h.signal_id = s.id WHERE s.token_id = $1 ORDER BY s.created_at DESC LIMIT $2`,
    [tokenId, limit],
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
  return queryOne<{ value: { finishedAt?: string; startedAt: string; stored: number; candidates: number; signalsCreated: number; securityChecked: number; spam: number; errors: string[]; regime?: Record<string, number | null> } }>(
    "SELECT value FROM app_settings WHERE key = 'ingestion_status'",
  );
}

export async function latestSnapshotTime() {
  const r = await queryOne<{ at: Date | null }>("SELECT max(captured_at) AS at FROM market_snapshots WHERE is_demo = $1", [env.demoMode]);
  return r?.at ?? null;
}
