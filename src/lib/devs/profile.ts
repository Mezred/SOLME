import { query, queryOne } from "@/lib/db";

/**
 * A creator's profile for Proven Devs: wallets, launch history with outcomes, sells of their own coins, and a
 * reputation class backed by the evidence shown. Linked wallets are wallets first funded by the same wallet: that is
 * an inference (a shared funder can be a service), shown with its evidence, never proof of one owner. A failed coin
 * says nothing about intent, so no class calls anyone a scammer.
 */

/** A funder shared by this many creators is a service or exchange: it links nobody. */
const HUB_CREATORS = 20;
/** A dev sale of at least this share of supply counts as "sold early" on that launch. */
const SOLD_PCT = 5;

export type Reputation = "proven" | "promising" | "mixed" | "serial" | "unproven" | "new";

export const REPUTATION: Record<Reputation, { label: string; tone: "up" | "neutral" | "warn" | "down"; text: string }> = {
  proven: { label: "Proven", tone: "up", text: "Earlier coins migrated and held their value, with enough recent history to judge." },
  promising: { label: "Promising", tone: "neutral", text: "A good record so far, but too few recent launches to be confident." },
  mixed: { label: "Mixed", tone: "neutral", text: "Some coins migrated, but most did not or did not hold." },
  serial: { label: "Serial launcher", tone: "warn", text: "Many coins launched and none migrated. Not proof of bad intent, but the record gives no reason for confidence." },
  unproven: { label: "Unproven", tone: "neutral", text: "A few launches and no migration yet." },
  new: { label: "New", tone: "neutral", text: "First recorded launch: no history to judge." },
};

export type Outcome = "held" | "collapsed" | "migrated" | "curve" | "failed";
export const OUTCOME: Record<Outcome, string> = {
  held: "Migrated and held",
  collapsed: "Migrated, then lost over half its value",
  migrated: "Migrated (value after not measured)",
  curve: "Still on the bonding curve",
  failed: "Never migrated",
};

/** Pure: the reputation class from the record. */
export function devReputation(d: { launches: number; migrated: number; score: number | null; confidence: string | null }): Reputation {
  if (d.launches <= 1) return "new";
  if (d.score !== null && d.score >= 60) return d.confidence === "low" || d.confidence === null ? "promising" : "proven";
  if (d.migrated === 0) return d.launches >= 10 ? "serial" : "unproven";
  return "mixed";
}

/** Pure: what happened to one launch. */
export function launchOutcome(l: { complete: boolean; migrated_at: Date | null; created_at: Date; mcap_at_migration_usd: number | null; held_mcap_usd: number | null }, now = Date.now()): Outcome {
  if (l.migrated_at || l.complete) {
    if (l.mcap_at_migration_usd && l.held_mcap_usd !== null) return l.held_mcap_usd >= 0.5 * l.mcap_at_migration_usd ? "held" : "collapsed";
    return "migrated";
  }
  return now - new Date(l.created_at).getTime() < 24 * 3_600_000 ? "curve" : "failed";
}

export interface DevLaunch {
  mint: string;
  symbol: string | null;
  name: string | null;
  pool: string;
  creator: string;
  created_at: Date;
  migrated_at: Date | null;
  complete: boolean;
  mcap_at_migration_usd: number | null;
  held_mcap_usd: number | null;
  peak_market_cap_usd: number | null;
  source: string;
  dev_sold_pct: number | null;
  first_sell_at: Date | null;
  check_passed: boolean | null;
  token_id: string | null;
}

export async function loadDevProfile(creator: string) {
  const dev = await queryOne<{
    creator: string; launches: number; migrated: number; held: number | null; score: number | null; confidence: string | null; linked_wallets: number;
    funder: string | null; own_launches: number | null; own_migrated: number | null; best_market_cap_usd: number | null; last_launch_at: Date | null; backfilled_at: Date | null;
  }>("SELECT * FROM dev_profiles WHERE creator = $1", [creator]);
  if (!dev) return null;
  const sharing = dev.funder ? await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM dev_profiles WHERE funder = $1", [dev.funder]) : null;
  const hub = (sharing?.n ?? 0) >= HUB_CREATORS;
  const linked =
    dev.funder && !hub
      ? await query<{ creator: string; own_launches: number | null; own_migrated: number | null; last_launch_at: Date | null }>(
          "SELECT creator, own_launches, own_migrated, last_launch_at FROM dev_profiles WHERE funder = $1 AND creator <> $2 ORDER BY last_launch_at DESC NULLS LAST LIMIT 20",
          [dev.funder, creator],
        )
      : [];
  const wallets = [creator, ...linked.map((l) => l.creator)];
  const launches = await query<DevLaunch>(
    `SELECT l.mint, l.symbol, l.name, l.pool, l.creator, l.created_at, l.migrated_at, l.complete, l.mcap_at_migration_usd::float, l.held_mcap_usd::float,
            l.peak_market_cap_usd::float, l.source, s.pct AS dev_sold_pct, s.first_at AS first_sell_at, lc.passed AS check_passed, ta.id AS token_id
       FROM launchpad_tokens l
       LEFT JOIN LATERAL (SELECT sum(supply_pct)::float AS pct, min(sold_at) AS first_at FROM dev_sells d WHERE d.mint = l.mint) s ON true
       LEFT JOIN launch_checks lc ON lc.mint = l.mint
       LEFT JOIN token_assets ta ON ta.chain = l.chain AND ta.address = l.mint
      WHERE l.creator = ANY($1)
      ORDER BY l.created_at DESC LIMIT 200`,
    [wallets],
  );
  const soldEarly = launches.filter((l) => (l.dev_sold_pct ?? 0) >= SOLD_PCT).length;
  const watchedSells = launches.filter((l) => l.source === "stream").length;
  return {
    dev,
    reputation: devReputation(dev),
    linked,
    funderHub: hub,
    funderShared: sharing?.n ?? 0,
    launches: launches.map((l) => ({ ...l, outcome: launchOutcome(l) })),
    soldEarly,
    watchedSells,
  };
}
