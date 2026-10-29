import type { ChainId } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { findFunder } from "@/lib/launchpad/pump";
import { errorMessage, logger } from "@/lib/log";
import { getTokenPools, type TokenPool } from "@/lib/providers/dexscreener";
import { getBalance, getOwnerTokenBalanceRaw, getTransactionsForAddress, simulateTransaction, type RawTx } from "@/lib/providers/helius-history";
import { buildSwap, quoteSell } from "@/lib/providers/jupiter";
import { rateLimit } from "@/lib/ratelimit";
import { solPriceUsd } from "@/lib/wallets/smart-money";
import type { HolderReport } from "./holders";
import { POOL_AUTHORITIES } from "./pools";

const log = logger("investigate");

/**
 * Coin Check's deeper investigation of a Solana token, beyond the contract and holder snapshot:
 *  A. Sell simulation: Jupiter's best route for a SELL_USD sell, built for a wallet that really holds the coin and
 *     simulated on-chain (never sent). Shows whether selling works, the real price impact and any hidden tax.
 *  B. Connected holders: each top holder's first funder (cached for good), grouped: wallets funded by the dev or
 *     sharing a funder hold hidden supply; brand-new wallets among top holders.
 *  C. Liquidity depth: real SOL/USDC on the quote side of the pools and liquidity pulled in the last hours.
 *  D. Trading patterns: the last ~100 swaps on the main pool: unique traders, wallets trading in circles (wash),
 *     one wallet dominating volume, dust-size bot buys.
 * Each part fails soft (status "unavailable"). Cached CACHE_MINUTES; fresh runs are budgeted (Helius credits).
 * Everything is observed on-chain behaviour, not proof of intent.
 */
const CACHE_MINUTES = 5;
const VERSION = 6;
export const SELL_USD = 500;
const HOLDERS_TO_TRACE = 15;
const TRADES_TO_READ = 100;
/** Wallets funded within this long count as new (often created for the coin). */
const NEW_WALLET_DAYS = 3;
export const INVESTIGATE_BUDGET = { perUser: 30, perUserWindowSeconds: 600, global: 150, globalWindowSeconds: 3600 };

/** Exchange and service hot wallets: they fund thousands of unrelated wallets, so a shared one links nobody. */
const KNOWN_HUBS = new Set([
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S", // Binance
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm", "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE", // Coinbase
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD", "is6MTRHEgyFLNTfYcuV4QBWLjrZBfmhVNYR6ccgr8KV", // OKX
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", // Bybit
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5", // Kraken
  "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6", // KuCoin
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ", // MEXC
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w", // Gate
  "A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR", // Bitget
]);
/** A funder of this many wallets SOLME has traced is a service, not a person. */
const HUB_WALLETS = 50;

export type PartStatus = "ok" | "unavailable";

export interface SellSim {
  /** ok: the sell went through in simulation; fails: it reverted; no_route: Jupiter has no route; unavailable: not run. */
  status: "ok" | "fails" | "no_route" | "unavailable";
  amountUsd: number | null;
  receivedUsd: number | null;
  impactPct: number | null;
  /** Shortfall of the simulated proceeds vs the quote (a hidden transfer or sell tax). */
  taxPct: number | null;
  route: string | null;
  reason: string | null;
}

export interface Insiders {
  status: PartStatus;
  checked: number;
  devLinked: { wallets: number; pct: number };
  clusters: { funder: string; wallets: number; pct: number }[];
  newWallets: { wallets: number; pct: number };
  reason?: string;
}

export interface PoolDepth {
  status: PartStatus;
  pools: number;
  quoteSymbol: string | null;
  /** Quote amount in the main pool (SOL, USDC…) and whether that is a real asset or another token. */
  quoteAmount: number | null;
  realQuote: boolean | null;
  /** Fall from the highest liquidity seen in the last LIQ_WINDOW_HOURS, %. */
  dropPct: number | null;
  ageHours: number | null;
  reason?: string;
}

export interface TradingPattern {
  status: PartStatus;
  trades: number;
  traders: number;
  /**
   * Different wallets that bought at least DUST_USD in the sample. Volume bots spread dust trades over many wallets,
   * so dust-only buyers are left out (with no price, every buyer counts).
   */
  buyers: number;
  spanMinutes: number | null;
  /** Share of volume by wallets buying and selling back about what they bought, repeatedly. */
  washPct: number;
  topWalletPct: number;
  /** Share of trades worth under DUST_USD (volume-bot micro-trades). */
  dustPct: number;
  reason?: string;
}

export interface Investigation {
  version: number;
  computedAt: string;
  sell: SellSim;
  insiders: Insiders;
  pool: PoolDepth;
  trading: TradingPattern;
  /** The main pool the trades were read from (for explorer links). */
  pair: string | null;
}

/** The investigation for a coin: cached, or computed now within the credit budget. Null when nothing can run. */
export async function investigate(chain: ChainId, mint: string, holders: HolderReport | null, opts: { budgetUserId?: string } = {}): Promise<Investigation | null> {
  const cached = await queryOne<{ data: Investigation; fresh: boolean }>(
    `SELECT data, computed_at > now() - make_interval(mins => $3) AS fresh FROM token_investigations
      WHERE chain = $1 AND address = $2 AND (data->>'version')::int = $4 AND computed_at > now() - interval '1 hour'`,
    [chain, mint, CACHE_MINUTES, VERSION],
  );
  if (cached?.fresh) return cached.data;
  // Over budget: an older result (up to an hour) beats none.
  if (opts.budgetUserId && !(await rateLimit(`investigate:user:${opts.budgetUserId}`, INVESTIGATE_BUDGET.perUser, INVESTIGATE_BUDGET.perUserWindowSeconds)).allowed) return cached?.data ?? null;
  if (!(await rateLimit("investigate:global", INVESTIGATE_BUDGET.global, INVESTIGATE_BUDGET.globalWindowSeconds)).allowed) return cached?.data ?? null;

  const token = await queryOne<{ id: string; price: number | null; pair: string | null }>(
    `SELECT t.id, snap.price_usd AS price, mp.pair_address AS pair FROM token_assets t
       LEFT JOIN LATERAL (SELECT price_usd, pair_id FROM market_snapshots m WHERE m.token_id = t.id ORDER BY captured_at DESC LIMIT 1) snap ON true
       LEFT JOIN market_pairs mp ON mp.id = snap.pair_id
      WHERE t.chain = $1 AND t.address = $2`,
    [chain, mint],
  );
  const solUsd = await solPriceUsd();
  const pools = await getTokenPools(mint).catch(() => [] as TokenPool[]);
  const pair = pools[0]?.pairAddress ?? token?.pair ?? null;
  const fail = (what: string) => (err: unknown) => {
    log.warn(`${what} failed`, { mint, error: errorMessage(err) });
    return errorMessage(err).slice(0, 120);
  };

  const [sell, insiders, pool, trading] = await Promise.all([
    holders && token?.price
      ? simulateSell(mint, holders, token.price, solUsd).catch((e) => ({ ...NO_SELL, reason: fail("Sell simulation")(e) }))
      : Promise.resolve({ ...NO_SELL, reason: holders ? "No price yet" : "Holder list unavailable" }),
    holders
      ? connectedHolders(holders).catch((e) => ({ ...NO_INSIDERS, reason: fail("Holder tracing")(e) }))
      : Promise.resolve({ ...NO_INSIDERS, reason: "Holder list unavailable" }),
    poolDepth(token?.id ?? null, pools).catch((e) => ({ ...NO_POOL, reason: fail("Pool depth")(e) })),
    pair
      ? readTrading(pair, mint, token?.price ?? null).catch((e) => ({ ...NO_TRADING, reason: fail("Trading patterns")(e) }))
      : Promise.resolve({ ...NO_TRADING, reason: "No pool found" }),
  ]);
  const result: Investigation = { version: VERSION, computedAt: new Date().toISOString(), sell, insiders, pool, trading, pair };
  await query(
    `INSERT INTO token_investigations (chain, address, computed_at, data) VALUES ($1, $2, now(), $3)
     ON CONFLICT (chain, address) DO UPDATE SET computed_at = now(), data = EXCLUDED.data`,
    [chain, mint, JSON.stringify(result)],
  );
  if (trading.status === "ok") await recordBuyerStats(chain, mint, trading);
  return result;
}

const NO_SELL: SellSim = { status: "unavailable", amountUsd: null, receivedUsd: null, impactPct: null, taxPct: null, route: null, reason: null };
const NO_INSIDERS: Insiders = { status: "unavailable", checked: 0, devLinked: { wallets: 0, pct: 0 }, clusters: [], newWallets: { wallets: 0, pct: 0 } };
const NO_POOL: PoolDepth = { status: "unavailable", pools: 0, quoteSymbol: null, quoteAmount: null, realQuote: null, dropPct: null, ageHours: null };
const NO_TRADING: TradingPattern = { status: "unavailable", trades: 0, traders: 0, buyers: 0, spanMinutes: null, washPct: 0, topWalletPct: 0, dustPct: 0 };

// ── A. Sell simulation ──────────────────────────────────────────────────────────────────────────────────────────

const FEE_LAMPORTS = 5_000;
/** Failures that no slippage setting can fix. */
const BLOCKED = /frozen|transfer.?hook/i;
const MIN_PAYER_LAMPORTS = 10_000_000;

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/**
 * Why a simulated sell reverted, in plain words, from its logs. Null when the failure says nothing about the token:
 * the payer could not pay fees, or only Jupiter's router failed for a reason other than slippage (an account or route
 * issue with that wallet), so the next holder is tried instead.
 */
export function sellFailure(err: unknown, logs: string[]): string | null {
  const text = `${JSON.stringify(err)} ${logs.join(" ")}`;
  if (/insufficient lamports|InsufficientFundsForFee|insufficient funds for (fee|rent)/i.test(text)) return null;
  const failed = [...new Set(logs.map((l) => l.match(/^Program (\w+) failed/)?.[1]).filter(Boolean))];
  if (failed.length && failed.every((p) => p === JUPITER) && !/0x1771|slippage/i.test(text)) return null;
  if (/frozen/i.test(text)) return "the token account is frozen (freeze authority in use)";
  if (/transfer.?hook/i.test(text)) return "blocked by the token's transfer hook";
  if (/slippage|0x1771|exceeds desired slippage/i.test(text)) return "proceeds fall short of the quote by over 30% even with a fresh quote (hidden tax or trap)";
  const line = logs.find((l) => /error|failed/i.test(l));
  return line ? `the sell reverts: ${line.replace(/^Program \w+ /, "").slice(0, 100)}` : "the sell transaction reverts";
}

/** Tax implied by simulated proceeds vs the quote, %. */
export function impliedTaxPct(quotedLamports: number, receivedLamports: number): number {
  if (quotedLamports <= 0) return 0;
  return Math.max(0, Math.min(100, ((quotedLamports - receivedLamports) / quotedLamports) * 100));
}

async function simulateSell(mint: string, holders: HolderReport, priceUsd: number, solUsd: number | null): Promise<SellSim> {
  const candidates = holders.holders.filter((h) => h.kind === "wallet" && !POOL_AUTHORITIES.has(h.owner)).slice(0, 6);
  let noRoute = false;
  for (const h of candidates) {
    const [bal, lamports] = await Promise.all([getOwnerTokenBalanceRaw(h.owner, mint), getBalance(h.owner)]);
    if (!bal || bal.amount <= BigInt(0) || lamports < MIN_PAYER_LAMPORTS) continue;
    const target = BigInt(Math.floor((SELL_USD / priceUsd) * 10 ** bal.decimals));
    const amount = target > BigInt(0) && target < bal.amount ? target : bal.amount;
    let quote = await quoteSell(mint, amount);
    if (!quote) {
      noRoute = true;
      break;
    }
    let sim = await simulateTransaction(await buildSwap(quote, h.owner), [h.owner]);
    // A fast-moving coin can move past 10% slippage within a block. Before calling a sell blocked, try again with a
    // fresh quote at 30%: a real trap (frozen account, hook, tax) fails either way, and a tax still shows as a shortfall.
    if (sim.err && !BLOCKED.test(`${JSON.stringify(sim.err)} ${sim.logs.join(" ")}`) && sellFailure(sim.err, sim.logs) !== null) {
      const wider = await quoteSell(mint, amount, 3000);
      if (wider) {
        quote = wider;
        sim = await simulateTransaction(await buildSwap(quote, h.owner), [h.owner]);
      }
    }
    const amountUsd = (Number(amount) / 10 ** bal.decimals) * priceUsd;
    const route = [...new Set(quote.routePlan.map((r) => r.swapInfo.label).filter(Boolean))].join(" → ") || null;
    const impactPct = Number(quote.priceImpactPct) * 100;
    if (sim.err) {
      const reason = sellFailure(sim.err, sim.logs);
      if (reason === null) continue; // this holder cannot pay fees: try the next one
      return { status: "fails", amountUsd, receivedUsd: null, impactPct, taxPct: null, route, reason };
    }
    const after = sim.lamports[0];
    if (after === null || after === undefined) return { ...NO_SELL, reason: "Simulation returned no balance" };
    const received = after - lamports + FEE_LAMPORTS;
    const taxPct = impliedTaxPct(Number(quote.outAmount), received);
    return { status: "ok", amountUsd, receivedUsd: solUsd ? (received / 1e9) * solUsd : null, impactPct, taxPct, route, reason: null };
  }
  return noRoute ? { ...NO_SELL, status: "no_route", reason: "Jupiter has no route to sell this coin" } : { ...NO_SELL, reason: "No holder wallet could be used for the simulation" };
}

// ── B. Connected holders ───────────────────────────────────────────────────────────────────────────────────────

interface Origin {
  funder: string | null;
  firstAt: number | null;
}

/** First funder and first activity of each wallet: from the cache, else one page of its oldest transactions. */
async function origins(wallets: string[]): Promise<Map<string, Origin>> {
  const out = new Map<string, Origin>();
  if (!wallets.length) return out;
  const rows = await query<{ address: string; funder: string | null; first_at: Date | null }>("SELECT address, funder, first_at FROM wallet_origins WHERE address = ANY($1)", [wallets]);
  for (const r of rows) out.set(r.address, { funder: r.funder, firstAt: r.first_at ? new Date(r.first_at).getTime() / 1000 : null });
  const missing = wallets.filter((w) => !out.has(w));
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(
      missing.slice(i, i + 5).map(async (w) => {
        const page = await getTransactionsForAddress(w, { sortOrder: "asc", limit: 10 });
        const o = { funder: findFunder(w, page.txs), firstAt: page.txs.find((t) => t.blockTime)?.blockTime ?? null };
        out.set(w, o);
        await query(
          `INSERT INTO wallet_origins (address, funder, first_at) VALUES ($1, $2, to_timestamp($3))
           ON CONFLICT (address) DO UPDATE SET funder = EXCLUDED.funder, first_at = EXCLUDED.first_at, checked_at = now()`,
          [w, o.funder, o.firstAt],
        );
      }),
    );
  }
  return out;
}

/** Pure: groups holders by funder (hubs excluded) and links them to the dev. */
export function groupHolders(
  holders: { owner: string; pct: number }[],
  origin: Map<string, Origin>,
  dev: { address: string; funder: string | null } | null,
  isHub: (a: string) => boolean,
  now = Date.now() / 1000,
): Omit<Insiders, "status"> {
  const devFunder = dev?.funder && !isHub(dev.funder) ? dev.funder : null;
  const linked = holders.filter((h) => {
    if (!dev || h.owner === dev.address) return false;
    const f = origin.get(h.owner)?.funder ?? null;
    return f === dev.address || (devFunder !== null && (f === devFunder || h.owner === devFunder));
  });
  const groups = new Map<string, { owner: string; pct: number }[]>();
  for (const h of holders) {
    const f = origin.get(h.owner)?.funder;
    if (!f || isHub(f)) continue;
    groups.set(f, [...(groups.get(f) ?? []), h]);
  }
  const clusters = [...groups]
    .filter(([, g]) => g.length >= 2)
    .map(([funder, g]) => ({ funder, wallets: g.length, pct: g.reduce((s, h) => s + h.pct, 0) }))
    .sort((a, b) => b.pct - a.pct);
  const fresh = holders.filter((h) => {
    const t = origin.get(h.owner)?.firstAt;
    return t !== null && t !== undefined && now - t < NEW_WALLET_DAYS * 86_400;
  });
  const sum = (l: { pct: number }[]) => l.reduce((s, h) => s + h.pct, 0);
  return {
    checked: holders.length,
    devLinked: { wallets: linked.length, pct: sum(linked) },
    clusters,
    newWallets: { wallets: fresh.length, pct: sum(fresh) },
  };
}

async function connectedHolders(report: HolderReport): Promise<Insiders> {
  const top = report.holders.filter((h) => h.kind === "wallet" && !h.isDev).slice(0, HOLDERS_TO_TRACE);
  const dev = report.dev?.address ?? null;
  const origin = await origins([...top.map((h) => h.owner), ...(dev ? [dev] : [])]);
  const funders = [...new Set([...origin.values()].map((o) => o.funder).filter((f): f is string => Boolean(f)))];
  const hubs = new Set(
    funders.length
      ? (await query<{ funder: string }>(
          `SELECT funder FROM (SELECT funder, count(*) AS n FROM wallet_origins WHERE funder = ANY($1) GROUP BY funder) x WHERE n >= $2
           UNION SELECT funder FROM dev_profiles WHERE funder = ANY($1) GROUP BY funder HAVING count(*) >= 20`,
          [funders, HUB_WALLETS],
        )).map((r) => r.funder)
      : [],
  );
  const isHub = (a: string) => KNOWN_HUBS.has(a) || hubs.has(a);
  return { status: "ok", ...groupHolders(top, origin, dev ? { address: dev, funder: origin.get(dev)?.funder ?? null } : null, isHub) };
}

// ── C. Liquidity depth ─────────────────────────────────────────────────────────────────────────────────────────

const REAL_QUOTES = new Set(["SOL", "WSOL", "USDC", "USDT"]);
const LIQ_WINDOW_HOURS = 3;

async function poolDepth(tokenId: string | null, pools: TokenPool[]): Promise<PoolDepth> {
  const main = pools[0];
  const hist = tokenId
    ? await queryOne<{ peak: number | null; now: number | null }>(
        `SELECT max(liquidity_usd)::float AS peak,
                (SELECT liquidity_usd::float FROM market_snapshots WHERE token_id = $1 ORDER BY captured_at DESC LIMIT 1) AS now
           FROM market_snapshots WHERE token_id = $1 AND captured_at > now() - make_interval(hours => $2)`,
        [tokenId, LIQ_WINDOW_HOURS],
      )
    : null;
  const live = main?.liquidityUsd ?? hist?.now ?? null;
  const dropPct = hist?.peak && live !== null && hist.peak > 0 ? Math.max(0, (1 - live / hist.peak) * 100) : null;
  if (!main) return { ...NO_POOL, status: hist ? "ok" : "unavailable", dropPct, reason: "No pool listed" };
  return {
    status: "ok",
    pools: pools.length,
    quoteSymbol: main.quoteSymbol,
    quoteAmount: main.liquidityQuote,
    realQuote: main.quoteSymbol ? REAL_QUOTES.has(main.quoteSymbol.toUpperCase()) : null,
    dropPct,
    ageHours: main.pairCreatedAt ? (Date.now() - main.pairCreatedAt) / 3_600_000 : null,
  };
}

// ── D. Trading patterns ────────────────────────────────────────────────────────────────────────────────────────

const DUST_USD = 2;
/** Pool-side vault owners of the common AMMs (besides the pool account itself). */
const AMM_AUTHORITIES = POOL_AUTHORITIES;

/**
 * Pure: patterns in recent swaps of `mint` on `pool`. The trader of a swap is whoever's balance of the coin moved
 * (not the fee payer: volume bots pay fees from one wallet and trade from others); trades are valued in USD from the
 * token amount, so micro-trades count too.
 */
export function analyseTrades(txs: RawTx[], mint: string, pool: string, priceUsd: number | null): Omit<TradingPattern, "status"> {
  // Per transaction: each owner's change in the coin.
  const moves = txs.map((tx) => {
    const d = new Map<string, { raw: number; decimals: number }>();
    const add = (b: { mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }, sign: 1 | -1) => {
      if (b.mint !== mint || !b.owner) return;
      const cur = d.get(b.owner) ?? { raw: 0, decimals: b.uiTokenAmount.decimals };
      cur.raw += sign * Number(b.uiTokenAmount.amount);
      d.set(b.owner, cur);
    };
    for (const b of tx.meta?.preTokenBalances ?? []) add(b, -1);
    for (const b of tx.meta?.postTokenBalances ?? []) add(b, 1);
    return { time: tx.blockTime ?? 0, d };
  });
  // The pool side: the pool account, a known AMM authority, or an owner present in nearly every swap.
  const seen = new Map<string, number>();
  for (const m of moves) for (const o of m.d.keys()) seen.set(o, (seen.get(o) ?? 0) + 1);
  const isPool = (o: string) => o === pool || AMM_AUTHORITIES.has(o) || (moves.length >= 10 && (seen.get(o) ?? 0) >= 0.9 * moves.length);

  const by = new Map<string, { buys: number; sells: number; buyUsd: number; sellUsd: number }>();
  let trades = 0;
  let volume = 0;
  let dust = 0;
  let first = Infinity;
  let last = 0;
  for (const m of moves) {
    for (const [owner, { raw, decimals }] of m.d) {
      if (raw === 0 || isPool(owner)) continue;
      const usd = priceUsd ? (Math.abs(raw) / 10 ** decimals) * priceUsd : 0;
      trades++;
      volume += usd;
      if (priceUsd && usd < DUST_USD) dust++;
      if (m.time) {
        first = Math.min(first, m.time);
        last = Math.max(last, m.time);
      }
      const w = by.get(owner) ?? { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 };
      if (raw > 0) {
        w.buys++;
        w.buyUsd += usd;
      } else {
        w.sells++;
        w.sellUsd += usd;
      }
      by.set(owner, w);
    }
  }
  // In circles: bought and sold back about the same amount within the sample (minutes): bots, not holders.
  const wash = [...by.values()].filter((w) => w.buys >= 1 && w.sells >= 1 && Math.abs(w.buyUsd - w.sellUsd) <= 0.2 * Math.max(w.buyUsd, w.sellUsd));
  const vol = (w: { buyUsd: number; sellUsd: number }) => w.buyUsd + w.sellUsd;
  const pct = (x: number, of: number) => (of > 0 ? (x / of) * 100 : 0);
  return {
    trades,
    traders: by.size,
    buyers: [...by.values()].filter((w) => w.buys > 0 && (!priceUsd || w.buyUsd >= DUST_USD)).length,
    spanMinutes: trades && last > first ? Math.max(1, Math.round((last - first) / 60)) : trades ? 1 : null,
    washPct: pct(wash.reduce((sum, w) => sum + vol(w), 0), volume),
    topWalletPct: pct(Math.max(0, ...[...by.values()].map(vol)), volume),
    dustPct: pct(dust, trades),
  };
}

export async function readTrading(pair: string, mint: string, priceUsd: number | null): Promise<TradingPattern> {
  const page = await getTransactionsForAddress(pair, { sortOrder: "desc", limit: TRADES_TO_READ });
  return { status: "ok", ...analyseTrades(page.txs, mint, pair, priceUsd) };
}

/** Unique buyers from a trade sample, kept for Early Coins (which has no other source of distinct wallets). */
export async function recordBuyerStats(chain: ChainId, mint: string, t: TradingPattern) {
  await query(
    `INSERT INTO token_buyer_stats (chain, address, computed_at, buyers, trades, span_minutes) VALUES ($1, $2, now(), $3, $4, $5)
     ON CONFLICT (chain, address) DO UPDATE SET computed_at = now(), buyers = EXCLUDED.buyers, trades = EXCLUDED.trades, span_minutes = EXCLUDED.span_minutes`,
    [chain, mint, t.buyers, t.trades, t.spanMinutes],
  );
}
