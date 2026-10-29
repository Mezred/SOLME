import type { ChainId } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { PROVEN_DEV_SCORE } from "@/lib/launchpad/pump";

/** Read models for the Trenches board and Smart Dev pages (see src/lib/launchpad). */

export interface LaunchRow {
  mint: string;
  chain: ChainId;
  pool: string;
  name: string | null;
  symbol: string | null;
  creator: string;
  created_at: Date;
  initial_buy_sol: number | null;
  progress: number | null;
  market_cap_usd: number | null;
  peak_market_cap_usd: number | null;
  liquidity_usd: number | null;
  migrated_at: Date | null;
  complete: boolean;
  token_id: string | null;
  dev_launches: number | null;
  dev_migrated: number | null;
  dev_score: number | null;
  /** Background scam check (null: not checked yet or no market): see src/lib/launchpad/checks.ts. */
  check_passed: boolean | null;
  check_reason: string | null;
  checked_at: Date | null;
  /** Captured ~20s after launch (Solana): % of supply bought in the creation slot / by snipers in the first 10s. */
  bundle_pct: number | null;
  sniper_wallets: number | null;
  sniper_pct: number | null;
  /** % of supply the creator has sold, seen live (only for coins someone was alerted on). */
  dev_sold_pct: number | null;
}

const LAUNCH_COLUMNS = `l.mint, l.chain, l.pool, l.name, l.symbol, l.creator, l.created_at, l.initial_buy_sol, l.progress, l.market_cap_usd, l.peak_market_cap_usd,
  l.liquidity_usd, l.migrated_at, l.complete, ta.id AS token_id, d.launches AS dev_launches, d.migrated AS dev_migrated, d.score AS dev_score,
  lc.passed AS check_passed, lc.reason AS check_reason, lc.checked_at, lc.bundle_pct, lc.sniper_wallets, lc.sniper_pct,
  (SELECT sum(ds.supply_pct) FROM dev_sells ds WHERE ds.mint = l.mint) AS dev_sold_pct
  FROM launchpad_tokens l
  LEFT JOIN launch_checks lc ON lc.mint = l.mint
  LEFT JOIN dev_profiles d ON d.creator = l.creator
  LEFT JOIN token_assets ta ON ta.chain = l.chain AND ta.address = l.mint`;

/** Launchpad chains: pump.fun / LetsBonk on Solana. */
export const LAUNCHPAD_CHAINS: ChainId[] = ["solana"];

export interface DevRow {
  creator: string;
  /** Launches and migrations of the whole funder-linked group (see linked_wallets). */
  launches: number;
  migrated: number;
  /** Migrations whose market cap held an hour later and were not dumped by the dev. */
  held: number | null;
  linked_wallets: number;
  confidence: "low" | "medium" | "high" | null;
  best_market_cap_usd: number | null;
  score: number | null;
  last_launch_at: Date | null;
  backfilled_at: Date | null;
}

const DEV_CHAIN_SQL = `('solana' = ANY($CHAINS))`;

/** Devs with at least two recorded launches on the given chains, ranked by dev score. */
export async function devLeaderboard(limit: number, chains: ChainId[]) {
  return query<DevRow>(
    // One row per linked group (its most recently active wallet): linked wallets share one record.
    `SELECT * FROM (
       SELECT DISTINCT ON (CASE WHEN linked_wallets > 1 THEN funder ELSE creator END)
              creator, launches, migrated, held, linked_wallets, confidence, best_market_cap_usd, score, last_launch_at, backfilled_at
         FROM dev_profiles
        WHERE score IS NOT NULL AND launches >= 2 AND ${DEV_CHAIN_SQL.replaceAll("$CHAINS", "$2")}
        ORDER BY CASE WHEN linked_wallets > 1 THEN funder ELSE creator END, last_launch_at DESC NULLS LAST) g
      ORDER BY score DESC, held DESC NULLS LAST, best_market_cap_usd DESC NULLS LAST LIMIT $1`,
    [limit, chains],
  );
}

/** New launches in the last 24h by devs scoring at least `minScore`. */
export async function provenDevDeploys(minScore: number, chains: ChainId[], limit = 30) {
  return query<LaunchRow>(
    `SELECT ${LAUNCH_COLUMNS} WHERE l.chain = ANY($3) AND l.source = 'stream' AND l.created_at > now() - interval '24 hours' AND d.score >= $1 AND d.launches >= 2
      ORDER BY l.created_at DESC LIMIT $2`,
    [minScore, limit, chains],
  );
}

export async function devStats(chains: ChainId[]) {
  return queryOne<{ devs: number; proven: number; backfilled: number }>(
    `SELECT count(*)::int AS devs, count(*) FILTER (WHERE score >= $1 AND launches >= 2)::int AS proven,
            count(*) FILTER (WHERE backfilled_at IS NOT NULL)::int AS backfilled FROM dev_profiles WHERE ${DEV_CHAIN_SQL.replaceAll("$CHAINS", "$2")}`,
    [PROVEN_DEV_SCORE, chains],
  );
}
