import type { ChainId } from "@/lib/chains";
import type { MarketPairData } from "@/lib/providers/types";

/**
 * Heuristic filter for obvious junk. It removes clearly broken or impersonating listings;
 * it does not and cannot eliminate scams, and passing it says nothing about safety.
 */
const CANONICAL: Partial<Record<ChainId, Record<string, string[]>>> = {
  solana: {
    USDC: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    USDT: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
    SOL: ["So11111111111111111111111111111111111111112"],
    WSOL: ["So11111111111111111111111111111111111111112"],
  },
};

export const MIN_STORE_LIQUIDITY_USD = 1_000;
/** Launchpad bonding-curve pairs (pump.fun, Meteora DBC…) have no liquidity figure on DexScreener at all. */
const MIN_CURVE_MARKET_CAP_USD = 5_000;
const MIN_CURVE_VOLUME_H24_USD = 1_000;

/**
 * Whether a pair is worth storing. Pools need real liquidity; pairs that report no liquidity at all
 * (bonding curves) need real activity instead, and keep a null liquidity rather than an invented one.
 */
export function worthStoring(p: MarketPairData): boolean {
  if (p.liquidityUsd !== null) return p.liquidityUsd >= MIN_STORE_LIQUIDITY_USD;
  return (p.marketCap ?? p.fdv ?? 0) >= MIN_CURVE_MARKET_CAP_USD && (p.volume.h24 ?? 0) >= MIN_CURVE_VOLUME_H24_USD;
}

export function spamReason(p: MarketPairData): string | null {
  if (p.priceUsd === null || p.priceUsd <= 0) return "No valid price";
  const canon = CANONICAL[p.chain]?.[p.symbol.toUpperCase()];
  if (canon && !canon.includes(p.tokenAddress)) return `Impersonates ${p.symbol.toUpperCase()}`;
  if (/https?:|www\.|\.com|\.io|airdrop|claim|visit|reward/i.test(`${p.name} ${p.symbol}`)) return "Suspicious name";
  const liq = p.liquidityUsd ?? 0;
  const cap = p.fdv ?? p.marketCap ?? 0;
  if (cap > 1e11 && liq < 1e7) return "Implausible valuation vs liquidity";
  if (cap > 0 && liq > 0 && liq / cap > 5) return "Liquidity exceeds market cap (inconsistent data)";
  if (Math.abs(p.priceChange.h24 ?? 0) > 10_000 || Math.abs(p.priceChange.h1 ?? 0) > 5_000) return "Anomalous price change";
  const t = p.txns.h24;
  if (t && t.buys + t.sells > 0 && (p.volume.h24 ?? 0) / (t.buys + t.sells) > 5e5) return "Volume implausible for transaction count";
  return null;
}
