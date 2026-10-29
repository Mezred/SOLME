import { query } from "@/lib/db";
import { integrations } from "@/lib/env";
import { getWalletHoldings } from "@/lib/providers/helius-history";
import { solPriceUsd } from "./smart-money";

export interface Holding {
  mint: string;
  amount: number;
  symbol: string | null;
  tokenId: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface LiveHoldings {
  readAt: Date;
  sol: number;
  solUsd: number | null;
  /** Priced holdings, largest first. */
  priced: Holding[];
  /** Tokens SOLME has no market price for (dust, airdrops, dead coins). */
  unpriced: number;
}

const TTL_MS = 60_000;
/** Below this a priced holding is dust and not listed. */
const MIN_VALUE_USD = 1;
const cache = new Map<string, { at: number; v: LiveHoldings }>();
/** Stablecoins are valued at $1 (SOLME tracks no market for them). */
const STABLES: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

/** A wallet's balances read live from the chain, valued at SOLME's latest prices. Cached a minute per wallet. */
export async function liveHoldings(address: string): Promise<LiveHoldings | null> {
  if (!integrations.helius) return null;
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const [raw, solUsd] = await Promise.all([getWalletHoldings(address), solPriceUsd()]);
  const prices = raw.tokens.length
    ? await query<{ address: string; id: string; symbol: string; price: number | null }>(
        `SELECT t.address, t.id, t.symbol, snap.price_usd::float AS price FROM token_assets t
           LEFT JOIN LATERAL (SELECT price_usd FROM market_snapshots m WHERE m.token_id = t.id ORDER BY captured_at DESC LIMIT 1) snap ON true
          WHERE t.chain = 'solana' AND t.address = ANY($1)`,
        [raw.tokens.map((t) => t.mint)],
      )
    : [];
  const byMint = new Map(prices.map((p) => [p.address, p]));
  const all: Holding[] = raw.tokens.map((t) => {
    const p = byMint.get(t.mint);
    const price = STABLES[t.mint] ? 1 : (p?.price ?? null);
    return { mint: t.mint, amount: t.amount, symbol: STABLES[t.mint] ?? p?.symbol ?? null, tokenId: p?.id ?? null, priceUsd: price, valueUsd: price !== null ? price * t.amount : null };
  });
  const priced = all.filter((h) => h.valueUsd !== null && h.valueUsd >= MIN_VALUE_USD).sort((a, b) => b.valueUsd! - a.valueUsd!);
  const v: LiveHoldings = { readAt: new Date(), sol: raw.sol, solUsd, priced, unpriced: all.filter((h) => h.valueUsd === null).length };
  cache.set(address, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return v;
}
