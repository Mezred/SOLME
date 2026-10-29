import { CHAINS } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { dexscreener } from "@/lib/providers/dexscreener";
import { getRawTransaction, getSignatures, getTransactionsForAddress, type RawTx } from "@/lib/providers/helius-history";
import { liveWalletIds } from "./live";
import { findFunder } from "@/lib/launchpad/pump";
import { buildPositions, EARLY_WINDOW_SECONDS, evaluatePositions, extractSwap, extractTrades, scoreWalletV2, SCORING_VERSION, type OutOfSample, type TokenMarket } from "./scoring";

const log = logger("smart-money");

/**
 * Smart-money candidate pipeline (Solana only, Helius free plan).
 *  - discover: for tokens that recently pumped, read their first transactions (oldest first) and
 *    record wallets that bought within the first hour, skipping the creator and the launch slot (bundles).
 *  - score: pull each candidate's (or tracked wallet's) last 30 days and score it (see ./scoring).
 *
 * Credit budget at the defaults below: a scan is ≤ 2 pages (20 credits); a wallet score is ≤ 5 pages
 * (50 credits). With the scheduler's intervals that is at most ~15k credits/day. The live watcher (below)
 * adds ~10k/day for signature checks plus 1 credit per new swap transaction it parses.
 */
const WINDOW_DAYS = 30;
const MAX_WALLET_PAGES = 5;
const SCAN_PAGES = 2;
const BUYERS_PER_TOKEN = 20;

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);

export async function solPriceUsd(): Promise<number | null> {
  const [sol] = await dexscreener.getTokens("solana", [CHAINS.solana.wrappedNative]).catch(() => []);
  return sol?.priceUsd ?? null;
}

/** Reads a mint's first transactions and returns first-hour buyers (excluding the creator and the launch slot). */
export async function findEarlyBuyers(mint: string, solUsd: number | null): Promise<{ launchAt: number | null; found: Map<string, { delay: number; sol: number }> }> {
  const txs: RawTx[] = [];
  let next: string | null = null;
  for (let page = 0; page < SCAN_PAGES; page++) {
    const res = await getTransactionsForAddress(mint, { sortOrder: "asc", paginationToken: next });
    txs.push(...res.txs);
    next = res.next;
    if (!next) break;
  }
  const found = new Map<string, { delay: number; sol: number }>();
  const first = txs.find((x) => x.blockTime);
  if (!first) return { launchAt: null, found };
  const launch = first.blockTime!;
  const creator = keyOf(first.transaction.message.accountKeys[0]);
  for (const tx of txs) {
    if (found.size >= BUYERS_PER_TOKEN) break;
    if (tx.slot === first.slot || !tx.blockTime || tx.blockTime - launch > EARLY_WINDOW_SECONDS) continue;
    const signer = keyOf(tx.transaction.message.accountKeys[0]);
    if (signer === creator || found.has(signer)) continue;
    const swap = extractSwap(signer, tx, solUsd);
    if (swap?.side === "buy" && swap.mint === mint) found.set(signer, { delay: tx.blockTime - launch, sol: swap.sol });
  }
  return { launchAt: launch, found };
}

/** Scans up to `limit` recently pumped Solana tokens for early buyers. */
export async function discoverEarlyBuyers(limit = 1): Promise<{ scanned: number; buyers: number }> {
  if (!env.heliusApiKey) return { scanned: 0, buyers: 0 };
  const tokens = await query<{ id: string; address: string }>(
    `SELECT t.id, t.address FROM token_assets t
       JOIN LATERAL (SELECT price_change_h6, price_change_h24, liquidity_usd FROM market_snapshots s
                      WHERE s.token_id = t.id ORDER BY captured_at DESC LIMIT 1) s ON true
      WHERE t.chain = 'solana' AND NOT t.is_demo AND NOT t.is_spam
        AND t.pair_created_at > now() - interval '7 days'
        AND (s.price_change_h24 >= 100 OR s.price_change_h6 >= 100) AND s.liquidity_usd >= 10000
        AND NOT EXISTS (SELECT 1 FROM smart_money_scans x WHERE x.token_id = t.id)
      ORDER BY s.price_change_h24 DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  if (tokens.length === 0) return { scanned: 0, buyers: 0 };
  const solUsd = await solPriceUsd();
  let buyers = 0;
  for (const t of tokens) {
    try {
      const { launchAt, found } = await findEarlyBuyers(t.address, solUsd);
      for (const [address, b] of found) {
        await query(
          `WITH w AS (
             INSERT INTO wallet_profiles (chain, address) VALUES ('solana', $1)
             ON CONFLICT (chain, address) DO UPDATE SET chain = EXCLUDED.chain RETURNING id)
           INSERT INTO smart_money_candidates (wallet_id, token_id, entry_delay_seconds, entry_sol)
           SELECT id, $2, $3, $4 FROM w ON CONFLICT (wallet_id, token_id) DO NOTHING`,
          [address, t.id, b.delay, b.sol],
        );
      }
      await query(
        `INSERT INTO smart_money_scans (token_id, launch_at, buyers) VALUES ($1, $2, $3) ON CONFLICT (token_id) DO NOTHING`,
        [t.id, launchAt ? new Date(launchAt * 1000) : null, found.size],
      );
      buyers += found.size;
    } catch (err) {
      log.warn("Early-buyer scan failed", { token: t.id, error: errorMessage(err) });
    }
  }
  return { scanned: tokens.length, buyers };
}

/** A funder shared by this many creators is an exchange or service wallet and says nothing about who is an insider. */
const HUB_MIN_CREATORS = 20;

/**
 * Why a wallet looks like a launch insider rather than an independent trader, or null. Uses recorded launches and dev
 * funders (Proven Devs), plus the wallet's own first funder.
 */
export async function insiderReason(address: string, funder: string | null): Promise<string | null> {
  const row = await queryOne<{ creator: boolean; funded_creator: boolean; funded_by_creator: boolean; shares_funder: boolean }>(
    `WITH hubs AS (SELECT funder FROM dev_profiles WHERE funder IS NOT NULL GROUP BY funder HAVING count(*) >= $3)
     SELECT EXISTS (SELECT 1 FROM launchpad_tokens WHERE creator = $1) AS creator,
            EXISTS (SELECT 1 FROM dev_profiles WHERE funder = $1) AS funded_creator,
            ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM launchpad_tokens WHERE creator = $2)) AS funded_by_creator,
            ($2::text IS NOT NULL AND $2 NOT IN (SELECT funder FROM hubs) AND EXISTS (SELECT 1 FROM dev_profiles WHERE funder = $2)) AS shares_funder`,
    [address, funder, HUB_MIN_CREATORS],
  );
  if (row?.creator) return "launches coins itself";
  if (row?.funded_creator) return "funded a coin creator";
  if (row?.funded_by_creator) return "funded by a coin creator";
  if (row?.shares_funder) return "same funder as a coin creator";
  return null;
}

/** Scores one Solana wallet from its last 30 days of history and stores the result. */
export async function scoreWalletById(walletId: string, address: string, solUsd: number | null): Promise<void> {
  // The coins the wallet was discovered on are left out of its score (see scoreWalletV2).
  const discovery = await query<{ address: string }>(
    "SELECT t.address FROM smart_money_candidates c JOIN token_assets t ON t.id = c.token_id WHERE c.wallet_id = $1",
    [walletId],
  );
  // First funder: one page of the wallet's oldest transactions (kept after the first lookup).
  let funder = (await queryOne<{ funder: string | null }>("SELECT funder FROM wallet_scores WHERE wallet_id = $1 AND funder IS NOT NULL", [walletId]))?.funder ?? null;
  if (!funder) {
    funder = await getTransactionsForAddress(address, { sortOrder: "asc", limit: 20 })
      .then((p) => findFunder(address, p.txs))
      .catch(() => null);
  }
  const insider = await insiderReason(address, funder);
  await upsertScore(walletId, await computeWalletScore(address, solUsd, { exclude: new Set(discovery.map((d) => d.address)), insider }), funder);
}

/** Fetches and scores a wallet without touching the database. */
export async function computeWalletScore(address: string, solUsd: number | null, opts: { exclude?: Set<string>; insider?: string | null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const fromTime = now - WINDOW_DAYS * 86_400;
  const txs: RawTx[] = [];
  let next: string | null = null;
  let truncated = false;
  for (let page = 0; page < MAX_WALLET_PAGES; page++) {
    const res = await getTransactionsForAddress(address, { sortOrder: "desc", fromTime, paginationToken: next });
    txs.push(...res.txs);
    next = res.next;
    if (!next) break;
    if (page === MAX_WALLET_PAGES - 1) truncated = true;
  }
  const oldest = txs.reduce((m, x) => (x.blockTime && x.blockTime < m ? x.blockTime : m), now);
  const coveredFrom = truncated ? oldest : fromTime;

  const swaps = txs.map((x) => extractSwap(address, x, solUsd)).filter((s) => s !== null);
  const positions = buildPositions(swaps);
  const mints = [...positions].sort((a, b) => b.solIn - a.solIn).slice(0, 90).map((p) => p.mint);
  const markets = new Map<string, TokenMarket | null>();
  const symbols = new Map<string, string>();
  try {
    const found = await dexscreener.getTokens("solana", mints);
    for (const mint of mints) markets.set(mint, null);
    for (const m of found) {
      markets.set(m.tokenAddress, { priceUsd: m.priceUsd, liquidityUsd: m.liquidityUsd, launchedAt: m.pairCreatedAt ? Math.floor(m.pairCreatedAt.getTime() / 1000) : null });
      symbols.set(m.tokenAddress, m.symbol);
    }
  } catch (err) {
    log.warn("Market lookup failed while scoring; open positions left unpriced", { wallet: address, error: errorMessage(err) });
  }
  const evaluated = evaluatePositions(positions, markets, solUsd, now);
  const s = scoreWalletV2(evaluated, swaps, Math.max(1, (now - coveredFrom) / 86_400), { now, exclude: opts.exclude, insider: opts.insider });

  const top = [...evaluated]
    .sort((a, b) => Math.abs(b.pnlSol ?? b.solIn) - Math.abs(a.pnlSol ?? a.solIn))
    .slice(0, 25)
    .map((p) => ({ mint: p.mint, symbol: symbols.get(p.mint) ?? null, status: p.status, buys: p.buys, sells: p.sells, solIn: p.solIn, solOut: p.solOut, pnlSol: p.pnlSol, multiple: p.multiple, entryDelaySeconds: p.entryDelaySeconds, early: p.early, hit: p.hit, firstBuyAt: p.firstBuyAt }));
  return {
    ...s,
    coveredFrom,
    insider: opts.insider ?? null,
    metrics: { components: s.components, positions: top, txsFetched: txs.length, truncated, solUsd, windowDays: WINDOW_DAYS, oos: s.oos, excludedDiscovery: s.excluded, insider: opts.insider ?? null },
  };
}

async function upsertScore(
  walletId: string,
  s: {
    version: string; score: number | null; trades: number; decided: number; open: number; wins: number; losses: number; pnlSol: number; earlyEntries: number;
    earlyHits: number; medianHoldMinutes: number | null; botLike: boolean; coveredFrom: number | null; metrics: unknown; oos: OutOfSample; insider: string | null;
  },
  funder: string | null,
) {
  await query(
    `INSERT INTO wallet_scores (wallet_id, scored_at, version, score, trades, decided_positions, open_positions, wins, losses, pnl_sol,
                                early_entries, early_hits, median_hold_minutes, bot_like, covered_from, metrics, oos_verdict, insider_reason, funder)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (wallet_id) DO UPDATE SET scored_at = now(), version = EXCLUDED.version, score = EXCLUDED.score, trades = EXCLUDED.trades,
       decided_positions = EXCLUDED.decided_positions, open_positions = EXCLUDED.open_positions, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
       pnl_sol = EXCLUDED.pnl_sol, early_entries = EXCLUDED.early_entries, early_hits = EXCLUDED.early_hits,
       median_hold_minutes = EXCLUDED.median_hold_minutes, bot_like = EXCLUDED.bot_like, covered_from = EXCLUDED.covered_from, metrics = EXCLUDED.metrics,
       oos_verdict = EXCLUDED.oos_verdict, insider_reason = EXCLUDED.insider_reason, funder = COALESCE(EXCLUDED.funder, wallet_scores.funder)`,
    [walletId, s.version, s.score, s.trades, s.decided, s.open, s.wins, s.losses, s.pnlSol, s.earlyEntries, s.earlyHits, s.medianHoldMinutes, s.botLike,
     s.coveredFrom ? new Date(s.coveredFrom * 1000) : null, JSON.stringify(s.metrics), s.oos.verdict, s.insider, funder],
  );
}

/** Wallets watched live for buys: scored, not bot-like, at or above this score (plus every wallet a user follows). */
export const WATCH_MIN_SCORE = 60;
const WATCH_PER_RUN = 15;
const WATCH_TX_PER_WALLET = 5;

/**
 * Polling watcher for smart wallets and every followed wallet, whatever its score (feeds smart-wallet and wallet
 * activity alerts, the Smart Wallets and Wallets pages). Followed wallets go first, so they stay covered while the
 * live feed is down. Rotates through watched wallets, WATCH_PER_RUN per run, reading only signatures newer than the last one
 * seen (getSignaturesForAddress, 1 credit) and parsing at most WATCH_TX_PER_WALLET new transactions each
 * (1 credit each). A wallet's first poll only records its newest signature, so old trades never alert.
 * Each buy stores the token's USD price at detection.
 */
export async function watchSmartWallets(): Promise<{ polled: number; swaps: number }> {
  if (!env.heliusApiKey) return { polled: 0, swaps: 0 };
  // Wallets on the live feed (src/lib/wallets/live.ts) are skipped while it is connected.
  const live = liveWalletIds();
  const wallets = await query<{ id: string; address: string; last_signature: string | null; known: boolean }>(
    `SELECT w.id, w.address, st.last_signature, (st.wallet_id IS NOT NULL) AS known
       FROM wallet_profiles w
       LEFT JOIN wallet_scores s ON s.wallet_id = w.id
       LEFT JOIN wallet_watch_state st ON st.wallet_id = w.id
       CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = w.id) AS followed) f
      WHERE w.chain = 'solana' AND (f.followed OR (s.score >= $1 AND NOT s.bot_like)) AND NOT (w.id = ANY($3::uuid[]))
      ORDER BY f.followed DESC, st.polled_at NULLS FIRST, s.score DESC NULLS LAST LIMIT $2`,
    [WATCH_MIN_SCORE, WATCH_PER_RUN, live],
  );
  if (wallets.length === 0) return { polled: 0, swaps: 0 };
  const solUsd = await solPriceUsd();
  const found: FoundSwap[] = [];

  for (const w of wallets) {
    try {
      // Signatures come newest-first. Parse the OLDEST new ones first and advance the cursor only as far as was
      // parsed, so a burst larger than WATCH_TX_PER_WALLET is finished on the next polls instead of skipped.
      const sigs = await getSignatures(w.address, { limit: 50, until: w.last_signature });
      let cursor = sigs[0]?.signature ?? w.last_signature;
      if (w.known) {
        const pending = [...sigs].reverse();
        const batch = pending.slice(0, WATCH_TX_PER_WALLET);
        for (const s of batch) {
          if (s.err) continue;
          const tx = await getRawTransaction(s.signature);
          for (const t of tx ? extractTrades(w.address, tx, solUsd) : []) {
            found.push({ walletId: w.id, signature: t.signature, time: t.time, mint: t.mint, side: t.side, amount: t.tokenAmount, sol: t.sol });
          }
        }
        if (pending.length > batch.length) cursor = batch[batch.length - 1].signature;
      }
      const newest = cursor;
      await query(
        `INSERT INTO wallet_watch_state (wallet_id, last_signature, polled_at) VALUES ($1, $2, now())
         ON CONFLICT (wallet_id) DO UPDATE SET last_signature = EXCLUDED.last_signature, polled_at = now()`,
        [w.id, newest],
      );
    } catch (err) {
      log.warn("Smart wallet poll failed", { wallet: w.id, error: errorMessage(err) });
      await query(
        `INSERT INTO wallet_watch_state (wallet_id, last_signature, polled_at) VALUES ($1, $2, now())
         ON CONFLICT (wallet_id) DO UPDATE SET polled_at = now()`,
        [w.id, w.last_signature],
      );
    }
  }

  await recordSwaps(found);
  return { polled: wallets.length, swaps: found.length };
}

export interface FoundSwap {
  walletId: string;
  signature: string;
  time: number;
  mint: string;
  side: "buy" | "sell";
  amount: number;
  /** SOL spent or received; null for a token↔token swap (estimated from market prices when stored). */
  sol: number | null;
}

/**
 * Stores detected swaps with the token's symbol, USD price, market cap and USD value at detection. A token↔token
 * swap gets an estimated SOL value (marked `solEstimated`). Returns how many were new.
 */
export async function recordSwaps(found: FoundSwap[]): Promise<number> {
  if (!found.length) return 0;
  const wsol = CHAINS.solana.wrappedNative;
  const markets = await dexscreener.getTokens("solana", [...new Set([wsol, ...found.map((f) => f.mint)])]).catch(() => []);
  const solUsd = markets.find((x) => x.tokenAddress === wsol)?.priceUsd ?? null;
  let added = 0;
  for (const f of found) {
    const m = markets.find((x) => x.tokenAddress === f.mint);
    const price = m?.priceUsd ?? null;
    const usd = f.sol !== null && solUsd ? f.sol * solUsd : price !== null ? f.amount * price : null;
    const sol = f.sol ?? (usd !== null && solUsd ? usd / solUsd : null);
    const raw = { sol, ...(f.sol === null ? { solEstimated: true } : {}), priceUsdAtDetection: price, mcapAtDetection: m?.marketCap ?? m?.fdv ?? null };
    const rows = await query(
      `INSERT INTO wallet_transactions (wallet_id, chain, tx_hash, block_time, direction, token_address, token_symbol, amount, amount_usd, provider, raw)
       VALUES ($1, 'solana', $2, to_timestamp($3), $4, $5, $6, $7, $8, 'helius-rpc', $9)
       ON CONFLICT (chain, tx_hash, wallet_id, token_address, direction) DO NOTHING RETURNING id`,
      [f.walletId, f.signature, f.time, f.side, f.mint, m?.symbol ?? null, f.amount, usd, JSON.stringify(raw)],
    );
    added += rows.length;
  }
  return added;
}

/** Scores due wallets: tracked/documented ones daily, discovered candidates every 3 days. */
export async function scoreDueWallets(limit = 3): Promise<{ scored: number; failed: number }> {
  if (!env.heliusApiKey) return { scored: 0, failed: 0 };
  const due = await query<{ id: string; address: string }>(
    `SELECT w.id, w.address FROM wallet_profiles w
       LEFT JOIN wallet_scores s ON s.wallet_id = w.id
       CROSS JOIN LATERAL (SELECT (w.is_public OR EXISTS (SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = w.id)) AS followed) f
      WHERE w.chain = 'solana'
        AND (f.followed OR EXISTS (SELECT 1 FROM smart_money_candidates c WHERE c.wallet_id = w.id))
        AND (s.wallet_id IS NULL OR s.version <> $2 OR s.scored_at < now() - CASE WHEN f.followed THEN interval '24 hours' ELSE interval '72 hours' END)
      ORDER BY (s.version IS DISTINCT FROM $2 AND s.score >= ${WATCH_MIN_SCORE}) DESC, f.followed DESC, s.scored_at NULLS FIRST LIMIT $1`,
    [limit, SCORING_VERSION],
  );
  if (due.length === 0) return { scored: 0, failed: 0 };
  const solUsd = await solPriceUsd();
  let scored = 0;
  let failed = 0;
  for (const w of due) {
    try {
      await scoreWalletById(w.id, w.address, solUsd);
      scored++;
    } catch (err) {
      failed++;
      log.warn("Wallet scoring failed", { wallet: w.id, error: errorMessage(err) });
      // Mark the attempt so one bad wallet cannot block the queue (retried on the normal cadence). A wallet that
      // already has a score keeps it: a transient provider error must not wipe a valid score.
      await query(
        `INSERT INTO wallet_scores (wallet_id, version, score, trades, decided_positions, open_positions, wins, losses, pnl_sol, early_entries, early_hits, metrics)
         VALUES ($1, $2, NULL, 0, 0, 0, 0, 0, 0, 0, 0, jsonb_build_object('error', $3::text))
         ON CONFLICT (wallet_id) DO UPDATE SET scored_at = now(),
           metrics = CASE WHEN wallet_scores.score IS NULL THEN EXCLUDED.metrics
                          ELSE wallet_scores.metrics || jsonb_build_object('lastRescoreError', $3::text) END`,
        [w.id, SCORING_VERSION, errorMessage(err).slice(0, 300)],
      );
    }
  }
  return { scored, failed };
}
