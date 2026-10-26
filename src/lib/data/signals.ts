import { z } from "zod";
import { CHAIN_IDS, type ChainId } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import type { Entitlements } from "@/lib/billing/entitlements";

const csv = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((x): x is T => (allowed as readonly string[]).includes(x)) : []));
const optNum = z.coerce.number().finite().optional().catch(undefined);

export const SIGNAL_TYPES = ["momentum", "accumulation", "breakout_watch", "distribution", "high_risk"] as const;
export const SIGNAL_SORTS = ["created", "score", "confidence", "volume", "liquidity", "change_h1", "change_h24", "mcap"] as const;

export const signalFilterSchema = z.object({
  chain: csv(CHAIN_IDS),
  type: csv(SIGNAL_TYPES),
  strength: csv(["strong", "moderate", "weak", "avoid"] as const),
  q: z.string().trim().max(80).optional().catch(undefined),
  minScore: optNum,
  minConfidence: optNum,
  minLiquidity: optNum,
  minVolume: optNum,
  minMcap: optNum,
  maxMcap: optNum,
  maxAgeHours: optNum,
  minChangeH1: optNum,
  minChangeH24: optNum,
  status: z.enum(["active", "all"]).optional().catch(undefined),
  sort: z.enum(SIGNAL_SORTS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(10).max(100).optional().catch(undefined),
});
export type SignalFilters = z.infer<typeof signalFilterSchema>;

export interface SignalRow {
  id: string;
  token_id: string;
  chain: ChainId;
  symbol: string;
  name: string;
  address: string;
  logo_url: string | null;
  signal_type: string;
  strength: string;
  ai_score: number;
  quality_score: number | null;
  momentum_score: number | null;
  risk_score: number | null;
  confidence_score: number;
  price_at_signal: number | null;
  entry_low: number | null;
  entry_high: number | null;
  invalidation: number | null;
  stop_loss: number | null;
  take_profits: { label: string; price: number; rMultiple: number }[] | null;
  rationale: string;
  risk_flags: string[];
  missing_data: string[];
  status: string;
  is_demo: boolean;
  created_at: Date;
  pair_created_at: Date | null;
  price_usd: number | null;
  price_change_m5: number | null;
  price_change_h1: number | null;
  price_change_h24: number | null;
  price_change_d7: number | null;
  volume_h24: number | null;
  liquidity_usd: number | null;
  market_cap: number | null;
  fdv: number | null;
  buys_h1: number | null;
  sells_h1: number | null;
  captured_at: Date | null;
  security_risk: string | null;
}

const SORT_SQL: Record<(typeof SIGNAL_SORTS)[number], string> = {
  created: "s.created_at",
  score: "s.ai_score",
  confidence: "s.confidence_score",
  volume: "snap.volume_h24",
  liquidity: "snap.liquidity_usd",
  change_h1: "snap.price_change_h1",
  change_h24: "snap.price_change_h24",
  mcap: "COALESCE(snap.market_cap, snap.fdv)",
};

export interface SignalPage {
  rows: SignalRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Notes about entitlement restrictions that were applied. */
  restrictions: string[];
}

/** Signal feed with server-side filtering, sorting, pagination and plan restrictions. */
export async function listSignals(f: SignalFilters, ent: Entitlements, opts: { historyMode?: boolean } = {}): Promise<SignalPage> {
  const where: string[] = ["s.is_demo = $1", "NOT t.is_spam"];
  const params: unknown[] = [env.demoMode];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const restrictions: string[] = [];
  const feat = ent.features;

  const chains = (f.chain.length ? f.chain : CHAIN_IDS).filter((c) => feat.chains.includes(c));
  if (f.chain.some((c) => !feat.chains.includes(c))) restrictions.push(`Your plan includes ${feat.chains.join(", ")}.`);
  where.push(`s.chain = ANY(${p(chains)})`);

  if (feat.signal_delay_minutes > 0) {
    where.push(`s.created_at <= now() - make_interval(mins => ${p(feat.signal_delay_minutes)})`);
    restrictions.push(`Signals are delayed ${feat.signal_delay_minutes} minutes on the ${ent.planName} plan.`);
  }
  where.push(`s.created_at >= now() - make_interval(days => ${p(feat.signal_history_days)})`);

  if (!opts.historyMode && f.status !== "all") where.push("s.status = 'active'");
  if (f.type.length) where.push(`s.signal_type = ANY(${p(f.type)})`);
  if (f.strength.length) where.push(`s.strength = ANY(${p(f.strength)})`);
  if (f.minScore !== undefined) where.push(`s.ai_score >= ${p(f.minScore)}`);
  if (f.q) {
    const like = p(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(t.symbol) LIKE ${like} OR lower(t.name) LIKE ${like} OR t.address = ${p(f.q)})`);
  }

  const advanced = [f.minConfidence, f.minLiquidity, f.minVolume, f.minMcap, f.maxMcap, f.maxAgeHours, f.minChangeH1, f.minChangeH24].some((x) => x !== undefined);
  if (advanced && !feat.advanced_filters) {
    restrictions.push("Advanced filters (liquidity, volume, market cap, age, price change, confidence) require Pro.");
  } else {
    if (f.minConfidence !== undefined) where.push(`s.confidence_score >= ${p(f.minConfidence)}`);
    if (f.minLiquidity !== undefined) where.push(`snap.liquidity_usd >= ${p(f.minLiquidity)}`);
    if (f.minVolume !== undefined) where.push(`snap.volume_h24 >= ${p(f.minVolume)}`);
    if (f.minMcap !== undefined) where.push(`COALESCE(snap.market_cap, snap.fdv) >= ${p(f.minMcap)}`);
    if (f.maxMcap !== undefined) where.push(`COALESCE(snap.market_cap, snap.fdv) <= ${p(f.maxMcap)}`);
    if (f.maxAgeHours !== undefined) where.push(`t.pair_created_at >= now() - make_interval(hours => ${p(f.maxAgeHours)})`);
    if (f.minChangeH1 !== undefined) where.push(`snap.price_change_h1 >= ${p(f.minChangeH1)}`);
    if (f.minChangeH24 !== undefined) where.push(`snap.price_change_h24 >= ${p(f.minChangeH24)}`);
  }

  const pageSize = f.pageSize ?? 25;
  const maxRows = feat.signal_feed_limit;
  const page = Math.min(f.page ?? 1, Math.max(1, Math.ceil(maxRows / pageSize)));
  const offset = (page - 1) * pageSize;
  const limit = Math.max(0, Math.min(pageSize, maxRows - offset));
  const sort = SORT_SQL[f.sort ?? "created"];
  const dir = f.dir === "asc" ? "ASC" : "DESC";

  const from = `
    FROM signals s
    JOIN token_assets t ON t.id = s.token_id
    LEFT JOIN LATERAL (
      SELECT * FROM market_snapshots ms WHERE ms.token_id = s.token_id ORDER BY ms.captured_at DESC LIMIT 1
    ) snap ON true
    LEFT JOIN LATERAL (
      SELECT risk_level FROM token_security_checks sc WHERE sc.token_id = s.token_id ORDER BY sc.checked_at DESC LIMIT 1
    ) sec ON true
    WHERE ${where.join(" AND ")}`;

  const [countRow] = await query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params);
  const rows = await query<SignalRow>(
    `SELECT s.id, s.token_id, s.chain, t.symbol, t.name, t.address, t.logo_url, s.signal_type, s.strength, s.ai_score, s.quality_score,
            s.momentum_score, s.risk_score, s.confidence_score, s.price_at_signal, s.entry_low, s.entry_high, s.invalidation, s.stop_loss,
            s.take_profits, s.rationale, s.risk_flags, s.missing_data, s.status, s.is_demo, s.created_at, t.pair_created_at,
            snap.price_usd, snap.price_change_m5, snap.price_change_h1, snap.price_change_h24, snap.price_change_d7, snap.volume_h24,
            snap.liquidity_usd, snap.market_cap, snap.fdv, snap.buys_h1, snap.sells_h1, snap.captured_at, sec.risk_level AS security_risk
     ${from}
     ORDER BY ${sort} ${dir} NULLS LAST, s.id
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  if (countRow.n > maxRows) restrictions.push(`The ${ent.planName} plan shows the latest ${maxRows} matching signals.`);
  return { rows, total: Math.min(countRow.n, maxRows), page, pageSize, restrictions };
}

export interface FactorRow {
  factor_key: string;
  category: string;
  score: number | null;
  weight: number;
  evidence: Record<string, unknown>;
  reason: string;
  missing: boolean;
}

export async function getSignal(id: string) {
  const s = await queryOne<SignalRow & { scoring_version: string; expires_at: Date }>(
    `SELECT s.*, t.symbol, t.name, t.address, t.logo_url, t.pair_created_at FROM signals s JOIN token_assets t ON t.id = s.token_id WHERE s.id = $1`,
    [id],
  );
  if (!s) return null;
  const factors = await query<FactorRow>("SELECT * FROM signal_factors WHERE signal_id = $1 ORDER BY weight DESC", [id]);
  const history = await queryOne("SELECT * FROM signal_history WHERE signal_id = $1", [id]);
  return { signal: s, factors, history };
}

/** Signal counts as visible to this plan (its chains and delay), so tiles match the user's feed. */
export async function signalStats(ent: Entitlements) {
  return queryOne<{ active: number; last24h: number; momentum: number; accumulation: number; breakout: number; distribution: number; high_risk: number; latest: Date | null }>(
    `SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h,
            count(*) FILTER (WHERE status = 'active' AND signal_type = 'momentum')::int AS momentum,
            count(*) FILTER (WHERE status = 'active' AND signal_type = 'accumulation')::int AS accumulation,
            count(*) FILTER (WHERE status = 'active' AND signal_type = 'breakout_watch')::int AS breakout,
            count(*) FILTER (WHERE status = 'active' AND signal_type = 'distribution')::int AS distribution,
            count(*) FILTER (WHERE status = 'active' AND signal_type = 'high_risk')::int AS high_risk,
            max(created_at) AS latest
       FROM signals
      WHERE is_demo = $1 AND chain = ANY($2) AND created_at <= now() - make_interval(mins => $3)`,
    [env.demoMode, ent.features.chains, ent.features.signal_delay_minutes],
  );
}

/** Aggregate measured outcomes (only signals with an observed 24h price). */
export async function outcomeStats(days: number) {
  return query<{ signal_type: string; n: number; measured: number; avg_return_24h: number | null; median_return_24h: number | null; positive_pct: number | null; tp_hit_pct: number | null; invalidated_pct: number | null }>(
    `SELECT s.signal_type, count(*)::int AS n,
            count(h.return_24h)::int AS measured,
            avg(h.return_24h) AS avg_return_24h,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY h.return_24h) AS median_return_24h,
            100.0 * avg(CASE WHEN h.return_24h > 0 THEN 1 WHEN h.return_24h IS NOT NULL THEN 0 END) AS positive_pct,
            100.0 * avg(CASE WHEN h.hit_take_profit THEN 1 WHEN h.hit_take_profit IS NOT NULL THEN 0 END) AS tp_hit_pct,
            100.0 * avg(CASE WHEN h.hit_invalidation THEN 1 WHEN h.hit_invalidation IS NOT NULL THEN 0 END) AS invalidated_pct
       FROM signals s LEFT JOIN signal_history h ON h.signal_id = s.id
      WHERE s.is_demo = $1 AND s.created_at > now() - make_interval(days => $2)
      GROUP BY s.signal_type ORDER BY s.signal_type`,
    [env.demoMode, days],
  );
}
