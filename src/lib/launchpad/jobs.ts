import { CHAINS, type ChainId } from "@/lib/chains";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { readableLabel } from "@/lib/format";
import { errorMessage, logger } from "@/lib/log";
import { dexscreener } from "@/lib/providers/dexscreener";
import { getAccounts, getTransactionsForAddress, type RawTx } from "@/lib/providers/helius-history";
import { solPriceUsd } from "@/lib/wallets/smart-money";
import { decodeBondingCurve, decodeLaunchLabPool, DEV_SCORE_VERSION, devScoreV2, findCreates, findFunder, heldAfterMigration, LAUNCHLAB_PROGRAM, PUMP_PROGRAM, type LaunchLabState, type LaunchOutcome } from "./pump";

const log = logger("launchpad");

/**
 * Background work for the launchpad board and dev tracker. Helius credit budget at the scheduler's
 * intervals: curve reads ≈ 2 calls / 30s (≈ 6k credits/day); dev backfills 2 devs × 2 pages / 10 min
 * (≈ 6k credits/day). DexScreener calls are keyless.
 */
const BACKFILL_PAGES = 2;

/** A funder shared by this many creators is an exchange or service hot wallet, not one dev: it links nobody. */
const HUB_MIN_CREATORS = 20;

/**
 * Recomputes dev score v2 for the given creators and every creator linked to them by a shared funder: launches,
 * migrations and outcomes are pooled across the linked group, so a fresh wallet inherits its group's record.
 */
export async function refreshDevProfiles(creators: string[]) {
  if (creators.length === 0) return;
  const members = await query<{ creator: string; grp: string }>(
    `WITH hubs AS (SELECT funder FROM dev_profiles WHERE funder IS NOT NULL GROUP BY funder HAVING count(*) >= $2),
          seeds AS (SELECT c AS creator, CASE WHEN d.funder IN (SELECT funder FROM hubs) THEN NULL ELSE d.funder END AS funder
                      FROM unnest($1::text[]) AS c LEFT JOIN dev_profiles d ON d.creator = c)
     SELECT creator, COALESCE(funder, creator) AS grp FROM seeds
     UNION
     SELECT d.creator, d.funder FROM dev_profiles d JOIN seeds s ON s.funder IS NOT NULL AND d.funder = s.funder`,
    [creators, HUB_MIN_CREATORS],
  );
  const launches = await query<LaunchFacts>(
    `SELECT l.creator, l.source, (l.complete OR l.migrated_at IS NOT NULL) AS migrated, l.created_at,
            l.mcap_at_migration_usd, l.held_mcap_usd, l.market_cap_usd,
            COALESCE((SELECT sum(s.supply_pct) FROM dev_sells s WHERE s.mint = l.mint AND s.sold_at <= COALESCE(l.migrated_at, now()) + interval '1 hour'), 0) >= 5 AS dumped
       FROM launchpad_tokens l WHERE l.creator = ANY($1)`,
    [[...new Set(members.map((m) => m.creator))]],
  );

  const groups = new Map<string, Set<string>>();
  for (const m of members) groups.set(m.grp, (groups.get(m.grp) ?? new Set()).add(m.creator));
  const values = [];
  const now = Date.now();
  for (const wallets of groups.values()) {
    const rows = launches.filter((l) => wallets.has(l.creator));
    const outcomes = rows.map((l) => launchOutcome(l, now));
    const v2 = devScoreV2(outcomes);
    const good = outcomes.filter((o) => o.migrated && o.held !== false && !o.devDumped);
    const best = Math.max(0, ...good.map((o) => o.mcapUsd ?? 0));
    const last = rows.reduce<Date | null>((a, l) => (!a || l.created_at > a ? l.created_at : a), null);
    for (const creator of wallets) {
      const own = rows.filter((l) => l.creator === creator);
      if (!own.length) continue;
      values.push({
        creator,
        launches: rows.length,
        migrated: rows.filter((l) => l.migrated).length,
        held: outcomes.filter((o) => o.migrated && o.held === true && !o.devDumped).length,
        own_launches: own.length,
        own_migrated: own.filter((l) => l.migrated).length,
        linked: wallets.size,
        best: best || null,
        score: v2.score,
        confidence: v2.confidence,
        last,
      });
    }
  }
  if (!values.length) return;
  await query(
    `INSERT INTO dev_profiles (creator, launches, migrated, held, own_launches, own_migrated, linked_wallets, best_market_cap_usd, score, confidence, score_version, last_launch_at, updated_at)
     SELECT creator, launches, migrated, held, own_launches, own_migrated, linked, best, score, confidence, $2, last, now()
       FROM jsonb_to_recordset($1::jsonb) AS v(creator text, launches int, migrated int, held int, own_launches int, own_migrated int, linked int, best numeric, score int, confidence text, last timestamptz)
     ON CONFLICT (creator) DO UPDATE SET launches = EXCLUDED.launches, migrated = EXCLUDED.migrated, held = EXCLUDED.held,
       own_launches = EXCLUDED.own_launches, own_migrated = EXCLUDED.own_migrated, linked_wallets = EXCLUDED.linked_wallets,
       best_market_cap_usd = EXCLUDED.best_market_cap_usd, score = EXCLUDED.score, confidence = EXCLUDED.confidence,
       score_version = EXCLUDED.score_version, last_launch_at = EXCLUDED.last_launch_at, updated_at = now()`,
    [JSON.stringify(values), DEV_SCORE_VERSION],
  );
}

interface LaunchFacts {
  creator: string;
  source: string;
  migrated: boolean;
  created_at: Date;
  mcap_at_migration_usd: number | null;
  held_mcap_usd: number | null;
  market_cap_usd: number | null;
  dumped: boolean;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

/** A stored launch as the score sees it. Migrations without a live measurement are judged after a day by whether the coin still has a real market cap. */
export function launchOutcome(l: LaunchFacts, now = Date.now()): LaunchOutcome {
  const ageDays = (now - new Date(l.created_at).getTime()) / 86_400_000;
  let held = l.migrated ? heldAfterMigration(num(l.mcap_at_migration_usd), num(l.held_mcap_usd)) : null;
  if (l.migrated && held === null && l.mcap_at_migration_usd === null && ageDays > 1 && l.market_cap_usd !== null) {
    held = Number(l.market_cap_usd) >= 30_000;
  }
  const mcap = l.held_mcap_usd ?? (l.mcap_at_migration_usd === null ? l.market_cap_usd : null);
  return { migrated: l.migrated, held, devDumped: l.migrated && l.dumped, ageDays, mcapUsd: num(mcap) };
}

/**
 * Finds the first funder of creators with a record worth linking (2+ launches or a migration): one page of their
 * oldest transactions. Creators funded by the same wallet are then scored together.
 */
export async function linkDevFunders(limit = 3): Promise<number> {
  if (!env.heliusApiKey) return 0;
  const due = await query<{ creator: string }>(
    `SELECT d.creator FROM dev_profiles d
      WHERE d.funder_checked_at IS NULL AND (COALESCE(d.own_launches, d.launches) >= 2 OR COALESCE(d.own_migrated, d.migrated) >= 1)
        AND EXISTS (SELECT 1 FROM launchpad_tokens l WHERE l.creator = d.creator AND l.chain = 'solana')
      ORDER BY d.last_launch_at DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  for (const { creator } of due) {
    let funder: string | null = null;
    try {
      funder = findFunder(creator, (await getTransactionsForAddress(creator, { sortOrder: "asc", limit: 20 })).txs);
    } catch (err) {
      log.warn("Dev funder lookup failed", { creator, error: errorMessage(err) });
    }
    await query("UPDATE dev_profiles SET funder = $2, funder_checked_at = now() WHERE creator = $1", [creator, funder]);
    await refreshDevProfiles([creator]);
  }
  return due.length;
}

/** After a scoring change: recompute devs still on an older score version, in batches. */
export async function rescoreOldDevs(limit = 500): Promise<number> {
  const rows = await query<{ creator: string }>("SELECT creator FROM dev_profiles WHERE score_version < $1 LIMIT $2", [DEV_SCORE_VERSION, limit]);
  if (!rows.length) return 0;
  await refreshDevProfiles(rows.map((r) => r.creator));
  // Rows without launches left (pruned) keep their old values; mark them so they are not picked again.
  await query("UPDATE dev_profiles SET score_version = $2 WHERE creator = ANY($1) AND score_version < $2", [rows.map((r) => r.creator), DEV_SCORE_VERSION]);
  return rows.length;
}

/** Migrations seen live that still need their at-migration or one-hour-later price (checked ahead of the rest). */
const MIGRATION_DUE = `(migrated_at > now() - interval '3 hours' AND (mcap_at_migration_usd IS NULL OR (held_mcap_usd IS NULL AND migrated_at < now() - interval '1 hour')))`;

/** Reads bonding curves (pump.fun and LetsBonk/LaunchLab) of young or progressing tokens (1 Helius credit per 100). */
export async function refreshCurves(): Promise<number> {
  if (!env.heliusApiKey) return 0;
  const rows = await query<{ mint: string; bonding_curve: string }>(
    `SELECT mint, bonding_curve FROM launchpad_tokens
      WHERE pool IN ('pump', 'bonk') AND source = 'stream' AND bonding_curve IS NOT NULL AND NOT complete AND migrated_at IS NULL
        AND (created_at > now() - interval '10 minutes' OR (progress >= 0.15 AND created_at > now() - interval '6 hours'))
      ORDER BY created_at DESC LIMIT 300`,
  );
  if (rows.length === 0) return 0;
  const [accounts, solUsd] = await Promise.all([getAccounts(rows.map((r) => r.bonding_curve)), solPriceUsd()]);

  // LaunchLab curves may raise in a token other than SOL; price those quote tokens once per run.
  const launchlab = new Map<string, LaunchLabState>();
  for (const r of rows) {
    const a = accounts.get(r.bonding_curve);
    const st = a?.owner === LAUNCHLAB_PROGRAM ? decodeLaunchLabPool(a.data) : null;
    if (st) launchlab.set(r.mint, st);
  }
  const quotePrices = new Map<string, number | null>([[CHAINS.solana.wrappedNative, solUsd]]);
  const otherQuotes = [...new Set([...launchlab.values()].map((s) => s.quoteMint))].filter((q) => !quotePrices.has(q));
  if (otherQuotes.length) {
    const priced = await dexscreener.getTokens("solana", otherQuotes).catch(() => []);
    for (const q of otherQuotes) quotePrices.set(q, priced.find((p) => p.tokenAddress === q)?.priceUsd ?? null);
  }

  const updates = [];
  for (const r of rows) {
    const a = accounts.get(r.bonding_curve);
    if (!a) continue;
    if (a.owner === PUMP_PROGRAM) {
      const st = decodeBondingCurve(a.data);
      if (st) updates.push({ mint: r.mint, progress: st.progress, mcap_sol: st.marketCapSol, mcap_usd: solUsd ? st.marketCapSol * solUsd : null, complete: st.complete });
      continue;
    }
    const ll = launchlab.get(r.mint);
    if (!ll) continue;
    const quoteUsd = quotePrices.get(ll.quoteMint) ?? null;
    const mcapUsd = quoteUsd !== null ? ll.marketCapQuote * quoteUsd : null;
    updates.push({ mint: r.mint, progress: ll.progress, mcap_sol: mcapUsd !== null && solUsd ? mcapUsd / solUsd : null, mcap_usd: mcapUsd, complete: ll.complete });
  }
  if (updates.length === 0) return 0;
  const done = await query<{ creator: string; complete: boolean }>(
    `UPDATE launchpad_tokens t SET progress = v.progress, market_cap_sol = v.mcap_sol,
            peak_market_cap_sol = GREATEST(t.peak_market_cap_sol, v.mcap_sol),
            initial_market_cap_sol = COALESCE(t.initial_market_cap_sol, v.mcap_sol),
            market_cap_usd = COALESCE(v.mcap_usd, t.market_cap_usd), peak_market_cap_usd = GREATEST(t.peak_market_cap_usd, v.mcap_usd),
            complete = t.complete OR v.complete, checked_at = now(), updated_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS v(mint text, progress numeric, mcap_sol numeric, mcap_usd numeric, complete boolean)
      WHERE t.mint = v.mint RETURNING t.creator, v.complete`,
    [JSON.stringify(updates)],
  );
  await refreshDevProfiles([...new Set(done.filter((d) => d.complete).map((d) => d.creator))]);
  return updates.length;
}

/** After migration the curve is closed, so market cap and liquidity come from DexScreener (per chain). */
export async function refreshLaunchMarkets(): Promise<number> {
  const rows = await query<{ mint: string; creator: string; chain: ChainId }>(
    `SELECT mint, creator, chain FROM launchpad_tokens
      WHERE (complete OR migrated_at IS NOT NULL) AND created_at > now() - interval '7 days'
        AND (checked_at IS NULL OR checked_at < now() - interval '30 minutes' OR ${MIGRATION_DUE})
      ORDER BY (${MIGRATION_DUE}) DESC, checked_at NULLS FIRST LIMIT 90`,
  );
  if (rows.length === 0) return 0;
  const values = [];
  for (const chain of [...new Set(rows.map((r) => r.chain))]) {
    const mints = rows.filter((r) => r.chain === chain).map((r) => r.mint);
    const native = CHAINS[chain].wrappedNative;
    const found = await dexscreener.getTokens(chain, [...mints, native]).catch(() => []);
    const find = (a: string) => found.find((f) => f.tokenAddress === a);
    const nativeUsd = find(native)?.priceUsd ?? null;
    for (const mint of mints) {
      const m = find(mint);
      const mcap = m ? (m.marketCap ?? m.fdv) : null;
      values.push({ mint, mcap, mcap_sol: mcap !== null && nativeUsd ? mcap / nativeUsd : null, liq: m?.liquidityUsd ?? null });
    }
  }
  await query(
    `UPDATE launchpad_tokens t SET market_cap_usd = COALESCE(v.mcap, t.market_cap_usd), peak_market_cap_usd = GREATEST(t.peak_market_cap_usd, v.mcap),
            -- Dev score v2: the first price after migration, then the first price at least an hour later (no market = 0).
            mcap_at_migration_usd = CASE WHEN t.migrated_at IS NOT NULL AND t.mcap_at_migration_usd IS NULL THEN v.mcap ELSE t.mcap_at_migration_usd END,
            held_mcap_usd = CASE WHEN t.migrated_at IS NOT NULL AND t.mcap_at_migration_usd IS NOT NULL AND t.held_mcap_usd IS NULL
                                  AND t.migrated_at < now() - interval '1 hour' THEN COALESCE(v.mcap, 0) ELSE t.held_mcap_usd END,
            peak_market_cap_sol = GREATEST(t.peak_market_cap_sol, v.mcap_sol),
            liquidity_usd = COALESCE(v.liq, t.liquidity_usd), checked_at = now(), updated_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS v(mint text, mcap numeric, mcap_sol numeric, liq numeric) WHERE t.mint = v.mint`,
    [JSON.stringify(values)],
  );
  await refreshDevProfiles([...new Set(rows.map((r) => r.creator))]);
  return rows.length;
}

/**
 * For creators whose new token is gaining traction, finds their earlier pump.fun launches in their
 * Helius history and records each one's current outcome from DexScreener.
 */
export async function backfillDevs(limit = 2): Promise<number> {
  if (!env.heliusApiKey) return 0;
  const devs = await query<{ creator: string }>(
    `SELECT DISTINCT t.creator FROM launchpad_tokens t LEFT JOIN dev_profiles d ON d.creator = t.creator
      WHERE t.chain = 'solana' AND t.source = 'stream' AND (t.progress >= 0.5 OR t.complete) AND t.created_at > now() - interval '7 days' AND d.backfilled_at IS NULL
      LIMIT $1`,
    [limit],
  );
  for (const { creator } of devs) {
    try {
      const txs: RawTx[] = [];
      let next: string | null = null;
      for (let page = 0; page < BACKFILL_PAGES; page++) {
        const res = await getTransactionsForAddress(creator, { sortOrder: "desc", paginationToken: next });
        txs.push(...res.txs);
        next = res.next;
        if (!next) break;
      }
      const creates = findCreates(creator, txs);
      const known = new Set((await query<{ mint: string }>("SELECT mint FROM launchpad_tokens WHERE mint = ANY($1)", [creates.map((c) => c.mint)])).map((r) => r.mint));
      const fresh = creates.filter((c) => !known.has(c.mint)).slice(0, 60);
      const markets = fresh.length ? await dexscreener.getTokens("solana", fresh.map((c) => c.mint)) : [];
      const values = fresh.map((c) => {
        const m = markets.find((x) => x.tokenAddress === c.mint);
        const mcap = m ? (m.marketCap ?? m.fdv) : null;
        // DexScreener lists pump.fun curves as "pumpfun" and does not list LaunchLab curves at all, so any
        // other primary DEX means the token migrated.
        return { mint: c.mint, pool: c.pool, creator, name: readableLabel(m?.name, c.mint), symbol: readableLabel(m?.symbol, c.mint), created: new Date(c.time * 1000).toISOString(), migrated: Boolean(m?.dexId && m.dexId !== "pumpfun"), mcap, liq: m?.liquidityUsd ?? null };
      });
      if (values.length) {
        await query(
          `INSERT INTO launchpad_tokens (mint, pool, creator, name, symbol, created_at, source, complete, market_cap_usd, peak_market_cap_usd, liquidity_usd, checked_at)
           SELECT mint, pool, creator, name, symbol, created, 'backfill', migrated, mcap, mcap, liq, now()
             FROM jsonb_to_recordset($1::jsonb) AS v(mint text, pool text, creator text, name text, symbol text, created timestamptz, migrated boolean, mcap numeric, liq numeric)
           ON CONFLICT (mint) DO NOTHING`,
          [JSON.stringify(values)],
        );
      }
      await refreshDevProfiles([creator]);
      await query("UPDATE dev_profiles SET backfilled_at = now(), backfill_error = NULL WHERE creator = $1", [creator]);
    } catch (err) {
      log.warn("Dev backfill failed", { creator, error: errorMessage(err) });
      await query(
        `INSERT INTO dev_profiles (creator, backfilled_at, backfill_error) VALUES ($1, now(), $2)
         ON CONFLICT (creator) DO UPDATE SET backfilled_at = now(), backfill_error = EXCLUDED.backfill_error`,
        [creator, errorMessage(err).slice(0, 300)],
      );
    }
  }
  return devs.length;
}

/** Drops month-old launches that never got going; launches that progressed are kept for dev history. */
export async function pruneLaunchpad() {
  await query(
    `DELETE FROM launchpad_tokens WHERE source = 'stream' AND created_at < now() - interval '30 days'
       AND NOT complete AND migrated_at IS NULL AND COALESCE(progress, 0) < 0.25`,
  );
}
