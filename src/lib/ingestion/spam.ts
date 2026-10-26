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
  ethereum: {
    USDC: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
    USDT: ["0xdac17f958d2ee523a2206206994597c13d831ec7"],
    WETH: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"],
  },
  bsc: {
    USDT: ["0x55d398326f99059ff775485246999027b3197955"],
    USDC: ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
    WBNB: ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"],
  },
  base: {
    USDC: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
    WETH: ["0x4200000000000000000000000000000000000006"],
  },
};

export const MIN_STORE_LIQUIDITY_USD = 1_000;

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
