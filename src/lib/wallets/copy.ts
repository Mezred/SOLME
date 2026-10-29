import { query } from "@/lib/db";
import { errorMessage, logger } from "@/lib/log";
import { dexscreener } from "@/lib/providers/dexscreener";

const log = logger("copy-stats");

export interface DetectedSwap {
  token: string;
  side: "buy" | "sell";
  /** USD price when SOLME detected the swap (what a copier acting on the alert would get). */
  price: number | null;
  time: number;
}

export interface CopyStats {
  trades: number;
  closed: number;
  wins: number;
  avgReturn: number | null;
  medianReturn: number | null;
}

/**
 * "If you copied" one wallet: every detected buy is entered at the detection price and exited at the detection price
 * of the wallet's next sell of that token; still-held buys are marked at `current` (no market any more = −100%).
 * Returns are percentages, equally weighted per buy. Ignores fees and slippage.
 */
export function copyStats(swaps: DetectedSwap[], current: Map<string, number | null>): CopyStats {
  const sorted = [...swaps].sort((a, b) => a.time - b.time);
  const returns: number[] = [];
  let closed = 0;
  for (const [i, buy] of sorted.entries()) {
    if (buy.side !== "buy" || !buy.price || buy.price <= 0) continue;
    const exit = sorted.slice(i + 1).find((s) => s.side === "sell" && s.token === buy.token && s.price !== null);
    let price: number | null | undefined;
    if (exit) {
      price = exit.price;
      closed++;
    } else {
      price = current.get(buy.token);
      if (price === undefined) continue; // not priced this run: leave it out rather than guess
    }
    returns.push(((price ?? 0) / buy.price - 1) * 100);
  }
  if (!returns.length) return { trades: 0, closed: 0, wins: 0, avgReturn: null, medianReturn: null };
  const s = [...returns].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    trades: returns.length,
    closed,
    wins: returns.filter((r) => r > 0).length,
    avgReturn: round(returns.reduce((a, b) => a + b, 0) / returns.length),
    medianReturn: round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2),
  };
}

/** Recomputes copy stats for every wallet with detected buys in the last 30 days (one DexScreener pass for open coins). */
export async function computeCopyStats(): Promise<number> {
  const rows = await query<{ wallet_id: string; token_address: string; direction: "buy" | "sell"; price: number | null; t: number }>(
    `SELECT wallet_id, token_address, direction, (raw->>'priceUsdAtDetection')::numeric AS price, extract(epoch FROM block_time)::int AS t
       FROM wallet_transactions
      WHERE provider = 'helius-rpc' AND direction IN ('buy', 'sell') AND block_time > now() - interval '30 days'
        AND wallet_id IN (SELECT wallet_id FROM wallet_transactions WHERE provider = 'helius-rpc' AND direction = 'buy' AND block_time > now() - interval '30 days')`,
  );
  if (!rows.length) return 0;
  const byWallet = new Map<string, DetectedSwap[]>();
  for (const r of rows) byWallet.set(r.wallet_id, [...(byWallet.get(r.wallet_id) ?? []), { token: r.token_address, side: r.direction, price: r.price === null ? null : Number(r.price), time: r.t }]);

  // Coins still held by someone: one batched price lookup. Coins DexScreener no longer lists count as worthless.
  const open = [...new Set(rows.filter((r) => r.direction === "buy").map((r) => r.token_address))];
  const current = new Map<string, number | null>();
  try {
    const markets = await dexscreener.getTokens("solana", open);
    for (const t of open) current.set(t, markets.find((m) => m.tokenAddress === t)?.priceUsd ?? null);
  } catch (err) {
    log.warn("Copy stats pricing failed", { error: errorMessage(err) });
    return 0; // without prices every open trade would look like a total loss
  }

  const values = [...byWallet].map(([wallet_id, swaps]) => ({ wallet_id, ...copyStats(swaps, current) })).filter((v) => v.trades > 0);
  await query(
    `INSERT INTO wallet_copy_stats (wallet_id, trades, closed, wins, avg_return, median_return, computed_at)
     SELECT wallet_id, trades, closed, wins, "avgReturn", "medianReturn", now()
       FROM jsonb_to_recordset($1::jsonb) AS v(wallet_id uuid, trades int, closed int, wins int, "avgReturn" numeric, "medianReturn" numeric)
     ON CONFLICT (wallet_id) DO UPDATE SET trades = EXCLUDED.trades, closed = EXCLUDED.closed, wins = EXCLUDED.wins,
       avg_return = EXCLUDED.avg_return, median_return = EXCLUDED.median_return, computed_at = now()`,
    [JSON.stringify(values)],
  );
  return values.length;
}
