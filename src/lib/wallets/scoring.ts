import type { RawTx } from "@/lib/providers/helius-history";

/**
 * Wallet scoring v1 — pure functions, no I/O.
 *
 * 1. extractSwap: one transaction -> at most one swap for the wallet, from raw balance deltas.
 *    A swap is exactly one non-quote token moving one way while SOL/WSOL/stables move the other.
 *    Quote is valued in SOL; stablecoin legs are converted at the current SOL price (approximation).
 * 2. buildPositions: swaps -> per-token positions (SOL in/out, timing).
 * 3. evaluatePositions + scoreWallet: positions + current market data -> metrics and a 0–100 score.
 *
 * Everything here describes past on-chain behaviour. It is not a classification and not advice.
 */
export const SCORING_VERSION = "wallet-score-v2";

const WSOL = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
/** Below this, a "quote" leg is just fees or token-account rent (~0.002 SOL), not a trade. */
const MIN_QUOTE_SOL = 0.01;
/** A position bought within this long of the token's launch is an early entry. */
export const EARLY_WINDOW_SECONDS = 3600;
/** Realized-plus-held value at or above this multiple of cost counts as catching a pump. */
const HIT_MULTIPLE = 2;
/** Minimum decided positions before a score is given at all. */
export const MIN_DECIDED = 5;
/** Positions smaller than this (dust launch-snipes) do not count toward win rate or early hits. */
export const MIN_POSITION_SOL = 0.1;

export interface Swap {
  signature: string;
  slot: number;
  time: number; // unix seconds
  mint: string;
  side: "buy" | "sell";
  tokenAmount: number;
  sol: number; // quote size in SOL, always positive
}

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);
const ui = (b: { uiTokenAmount: { amount: string; decimals: number } }) => Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals;

export function extractSwap(wallet: string, tx: RawTx, solUsd: number | null): Swap | null {
  const meta = tx.meta;
  if (!meta || meta.err || !tx.blockTime) return null;
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => keyOf(k) === wallet);
  if (idx < 0) return null;
  const k = keys[idx];
  const signer = typeof k === "string" ? idx < (tx.transaction.message.header?.numRequiredSignatures ?? 1) : Boolean(k.signer);
  if (!signer) return null; // only trades the wallet itself made

  let sol = ((meta.postBalances[idx] ?? 0) - (meta.preBalances[idx] ?? 0)) / 1e9;
  let usd = 0;
  const tokens = new Map<string, number>();
  const add = (b: TokenBalance, sign: 1 | -1) => {
    if (b.owner !== wallet) return;
    const v = sign * ui(b);
    if (b.mint === WSOL) sol += v;
    else if (STABLES.has(b.mint)) usd += v;
    else tokens.set(b.mint, (tokens.get(b.mint) ?? 0) + v);
  };
  for (const b of meta.preTokenBalances ?? []) add(b, -1);
  for (const b of meta.postTokenBalances ?? []) add(b, 1);

  const moved = [...tokens].filter(([, d]) => Math.abs(d) > 0);
  if (moved.length !== 1) return null;
  const [mint, delta] = moved[0];
  const quote = sol + (usd !== 0 && solUsd ? usd / solUsd : 0);
  if (Math.abs(quote) < MIN_QUOTE_SOL || Math.sign(quote) === Math.sign(delta)) return null;
  return {
    signature: tx.transaction.signatures[0],
    slot: tx.slot,
    time: tx.blockTime,
    mint,
    side: delta > 0 ? "buy" : "sell",
    tokenAmount: Math.abs(delta),
    sol: Math.abs(quote),
  };
}

type TokenBalance = NonNullable<NonNullable<RawTx["meta"]>["preTokenBalances"]>[number];

/** A detected trade for live tracking: `sol` is null for a token↔token swap (valued later from market prices). */
export type Trade = Omit<Swap, "sol"> & { sol: number | null };

/**
 * Every trade in one transaction, for watching wallets (not scoring): a SOL/stable swap as extractSwap sees it, or a
 * token↔token swap (one memecoin out, another in, no meaningful SOL leg) as a sell plus a buy.
 */
export function extractTrades(wallet: string, tx: RawTx, solUsd: number | null): Trade[] {
  const swap = extractSwap(wallet, tx, solUsd);
  if (swap) return [swap];
  const meta = tx.meta;
  if (!meta || meta.err || !tx.blockTime) return [];
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => keyOf(k) === wallet);
  if (idx < 0) return [];
  const k = keys[idx];
  const signer = typeof k === "string" ? idx < (tx.transaction.message.header?.numRequiredSignatures ?? 1) : Boolean(k.signer);
  if (!signer) return [];
  const tokens = new Map<string, number>();
  const add = (b: TokenBalance, sign: 1 | -1) => {
    if (b.owner !== wallet || b.mint === WSOL || STABLES.has(b.mint)) return;
    tokens.set(b.mint, (tokens.get(b.mint) ?? 0) + sign * ui(b));
  };
  for (const b of meta.preTokenBalances ?? []) add(b, -1);
  for (const b of meta.postTokenBalances ?? []) add(b, 1);
  const moved = [...tokens].filter(([, d]) => d !== 0);
  if (moved.length !== 2 || Math.sign(moved[0][1]) === Math.sign(moved[1][1])) return [];
  const base = { signature: tx.transaction.signatures[0], slot: tx.slot, time: tx.blockTime, sol: null };
  return moved.map(([mint, d]) => ({ ...base, mint, side: d > 0 ? "buy" : "sell", tokenAmount: Math.abs(d) }) as Trade);
}

export interface Position {
  mint: string;
  buys: number;
  sells: number;
  bought: number;
  sold: number;
  solIn: number;
  solOut: number;
  firstBuyAt: number | null;
  lastSellAt: number | null;
}

/** Aggregates swaps per token. Sells of tokens never bought inside the window are dropped (no cost basis). */
export function buildPositions(swaps: Swap[]): Position[] {
  const by = new Map<string, Position>();
  for (const s of [...swaps].sort((a, b) => a.time - b.time)) {
    let p = by.get(s.mint);
    if (!p) {
      if (s.side === "sell") continue;
      p = { mint: s.mint, buys: 0, sells: 0, bought: 0, sold: 0, solIn: 0, solOut: 0, firstBuyAt: null, lastSellAt: null };
      by.set(s.mint, p);
    }
    if (s.side === "buy") {
      p.buys++;
      p.bought += s.tokenAmount;
      p.solIn += s.sol;
      p.firstBuyAt ??= s.time;
    } else {
      p.sells++;
      p.sold += s.tokenAmount;
      p.solOut += s.sol;
      p.lastSellAt = s.time;
    }
  }
  return [...by.values()];
}

/** Current market facts for a token. `null` in the map means "looked up, no market" (dead or unlisted). */
export interface TokenMarket {
  priceUsd: number | null;
  liquidityUsd: number | null;
  launchedAt: number | null; // unix seconds (earliest known pair creation)
}

export interface EvaluatedPosition extends Position {
  status: "closed" | "dead" | "open";
  heldValueSol: number | null;
  pnlSol: number | null;
  multiple: number | null;
  entryDelaySeconds: number | null;
  early: boolean;
  hit: boolean;
}

const DEAD_LIQUIDITY_USD = 1_000;

export function evaluatePositions(
  positions: Position[],
  markets: Map<string, TokenMarket | null>,
  solUsd: number | null,
  now = Date.now() / 1000,
): EvaluatedPosition[] {
  return positions.map((p) => {
    const remaining = Math.max(0, p.bought - p.sold);
    const soldFrac = p.bought > 0 ? Math.min(1, p.sold / p.bought) : 0;
    const looked = markets.has(p.mint);
    const m = markets.get(p.mint) ?? null;
    const priceSol = m?.priceUsd != null && solUsd ? m.priceUsd / solUsd : null;
    // Null liquidity means a bonding curve (not reported), not an empty pool; collapse is caught below instead.
    const noMarket = looked && (!m || m.priceUsd === null || (m.liquidityUsd !== null && m.liquidityUsd < DEAD_LIQUIDITY_USD));
    const heldValueSol = remaining === 0 || noMarket ? 0 : priceSol !== null ? remaining * priceSol : null;
    const heldValueCollapsed = heldValueSol !== null && p.solIn > 0 && heldValueSol < 0.1 * p.solIn * (1 - soldFrac);

    let status: EvaluatedPosition["status"] = "open";
    if (soldFrac >= 0.9) status = "closed";
    else if ((noMarket || heldValueCollapsed) && p.firstBuyAt !== null && now - p.firstBuyAt > 86_400) status = "dead";

    const pnlSol = heldValueSol === null && status !== "closed" ? null : p.solOut + (heldValueSol ?? 0) - p.solIn;
    const multiple = pnlSol === null || p.solIn <= 0 ? null : (p.solOut + (heldValueSol ?? 0)) / p.solIn;
    const entryDelaySeconds = m?.launchedAt != null && p.firstBuyAt !== null ? Math.max(0, p.firstBuyAt - m.launchedAt) : null;
    const early = entryDelaySeconds !== null && entryDelaySeconds <= EARLY_WINDOW_SECONDS;
    return { ...p, status, heldValueSol, pnlSol, multiple, entryDelaySeconds, early, hit: early && multiple !== null && multiple >= HIT_MULTIPLE };
  });
}

export interface WalletScore {
  version: string;
  score: number | null;
  trades: number;
  decided: number;
  open: number;
  wins: number;
  losses: number;
  pnlSol: number;
  earlyEntries: number;
  earlyHits: number;
  medianHoldMinutes: number | null;
  botLike: boolean;
  components: { winRate: number; profit: number; early: number; consistency: number } | null;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Score = 35% win rate (shrunk toward 50% for small samples) + 30% profit (SOL, saturating)
 *       + 20% early-hit rate + 15% profit factor. Bot-like wallets are scored at 60%.
 */
export function scoreWallet(all: EvaluatedPosition[], swaps: Swap[], coveredDays: number): WalletScore {
  const evaluated = all.filter((p) => p.solIn >= MIN_POSITION_SOL);
  const decided = evaluated.filter((p) => (p.status === "closed" || p.status === "dead") && p.pnlSol !== null);
  const wins = decided.filter((p) => p.pnlSol! > 0).length;
  const losses = decided.length - wins;
  const pnlSol = decided.reduce((s, p) => s + p.pnlSol!, 0);
  const grossWin = decided.reduce((s, p) => s + Math.max(0, p.pnlSol!), 0);
  const grossLoss = decided.reduce((s, p) => s + Math.max(0, -p.pnlSol!), 0);
  const earlyEntries = evaluated.filter((p) => p.early).length;
  const earlyHits = evaluated.filter((p) => p.hit).length;
  const holds = decided.filter((p) => p.status === "closed" && p.firstBuyAt !== null && p.lastSellAt !== null).map((p) => (p.lastSellAt! - p.firstBuyAt!) / 60).sort((a, b) => a - b);
  const medianHoldMinutes = holds.length ? holds[Math.floor(holds.length / 2)] : null;
  const tradesPerDay = swaps.length / Math.max(1, coveredDays);
  const botLike = tradesPerDay > 150 || (medianHoldMinutes !== null && medianHoldMinutes < 2 && decided.length >= 10);

  const base = { version: SCORING_VERSION, trades: swaps.length, decided: decided.length, open: evaluated.filter((p) => p.status === "open").length, wins, losses, pnlSol, earlyEntries, earlyHits, medianHoldMinutes, botLike };
  if (decided.length < MIN_DECIDED) return { ...base, score: null, components: null };

  const winRate = clamp(((wins + 1) / (decided.length + 2)) * 100);
  const profit = clamp(50 + 50 * Math.tanh(pnlSol / 25));
  const early = clamp((earlyHits / decided.length / 0.3) * 100);
  const consistency = grossLoss === 0 ? 100 : clamp((grossWin / grossLoss / 3) * 100);
  const raw = 0.35 * winRate + 0.3 * profit + 0.2 * early + 0.15 * consistency;
  return { ...base, score: Math.round(botLike ? raw * 0.6 : raw), components: { winRate: Math.round(winRate), profit: Math.round(profit), early: Math.round(early), consistency: Math.round(consistency) } };
}

/** Trades opened in the last HOLDOUT_DAYS are kept out of the score and used to check it. */
export const HOLDOUT_DAYS = 10;
/** Too few holdout trades to judge below this; a "faded" wallet keeps 70% of its score; insiders are capped. */
const HOLDOUT_MIN_DECIDED = 3;
const FADED_FACTOR = 0.7;
export const INSIDER_CAP = 30;

export interface OutOfSample {
  verdict: "held_up" | "faded" | "too_few";
  decided: number;
  wins: number;
  pnlSol: number;
}

/** How the wallet did on the recent trades its score was not computed from. */
export function holdoutCheck(recent: EvaluatedPosition[]): OutOfSample {
  const decided = recent.filter((p) => p.solIn >= MIN_POSITION_SOL && (p.status === "closed" || p.status === "dead") && p.pnlSol !== null);
  const wins = decided.filter((p) => p.pnlSol! > 0).length;
  const pnlSol = decided.reduce((s, p) => s + p.pnlSol!, 0);
  if (decided.length < HOLDOUT_MIN_DECIDED) return { verdict: "too_few", decided: decided.length, wins, pnlSol };
  return { verdict: wins / decided.length >= 0.4 && pnlSol >= 0 ? "held_up" : "faded", decided: decided.length, wins, pnlSol };
}

/**
 * Wallet score v2 from evaluated positions:
 *  - positions in `exclude` (the coins the wallet was discovered on) are left out, so a wallet is not rewarded for
 *    the very pump that made us notice it;
 *  - the score comes from positions opened before the holdout window and is checked on the holdout: a wallet whose
 *    recent trades lose ("faded") keeps 70% of it. With too few older trades the whole window is scored, unchecked;
 *  - insiders are capped at INSIDER_CAP, below every smart-wallet list and alert.
 */
export function scoreWalletV2(all: EvaluatedPosition[], swaps: Swap[], coveredDays: number, opts: { now: number; exclude?: Set<string>; insider?: string | null }) {
  const kept = all.filter((p) => !opts.exclude?.has(p.mint));
  const cut = opts.now - HOLDOUT_DAYS * 86_400;
  const older = kept.filter((p) => p.firstBuyAt !== null && p.firstBuyAt < cut);
  const recent = kept.filter((p) => p.firstBuyAt !== null && p.firstBuyAt >= cut);
  const full = scoreWallet(kept, swaps, coveredDays);
  const trained = scoreWallet(older, swaps, coveredDays);
  const oos: OutOfSample = trained.score === null ? { ...holdoutCheck(recent), verdict: "too_few" } : holdoutCheck(recent);
  let score = trained.score ?? full.score;
  if (score !== null && oos.verdict === "faded") score = Math.round(score * FADED_FACTOR);
  if (score !== null && opts.insider) score = Math.min(score, INSIDER_CAP);
  return { ...full, score, oos, excluded: all.length - kept.length };
}
