import type { ChainId } from "@/lib/chains";
import { env } from "@/lib/env";

/**
 * GMGN token-page links, with the operator's referral code when GMGN_REFERRAL_CODE is set.
 * Format per docs.gmgn.ai/index/referral-link: https://gmgn.ai/{chain}/token/{code}_{address}.
 * Server-only (reads env). Returns null for chains GMGN does not list.
 */
const GMGN_CHAIN: Partial<Record<ChainId, string>> = { solana: "sol" };

export function gmgnTradeUrl(chain: ChainId, address: string): string | null {
  const seg = GMGN_CHAIN[chain];
  if (!seg) return null;
  return `https://gmgn.ai/${seg}/token/${env.gmgnReferralCode ? `${encodeURIComponent(env.gmgnReferralCode)}_` : ""}${address}`;
}

/** Disclosure shown wherever the link appears. */
export const GMGN_DISCLOSURE = "Opens GMGN, a third-party trading site. SOLME may earn a referral fee on trades; it does not affect any score.";
