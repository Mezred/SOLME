import { CHAINS, normalizeAddress, type ChainId } from "@/lib/chains";
import { transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { dexscreener } from "@/lib/providers/dexscreener";
import { goplus } from "@/lib/providers/goplus";
import { latestSecurity, storeMarketData, storeSecurity } from "./pipeline";
import { MIN_STORE_LIQUIDITY_USD, spamReason } from "./spam";

/**
 * On-demand lookup when a user pastes a contract address we are not tracking yet.
 * Fetches real provider data, stores it, and runs a security check. Returns created token ids.
 */
export async function lookupAddress(address: string, chains: ChainId[]): Promise<{ id: string; chain: ChainId }[]> {
  if (env.demoMode) return [];
  const found: { id: string; chain: ChainId }[] = [];
  for (const chain of chains) {
    const norm = normalizeAddress(chain, address);
    if (!norm) continue;
    const [pair] = await dexscreener.getTokens(chain, [norm]).catch(() => []);
    if (!pair || (pair.liquidityUsd ?? 0) < MIN_STORE_LIQUIDITY_USD) continue;
    const spam = spamReason(pair);
    const ids = await transaction((tx) => storeMarketData(tx, pair, spam, { discoveryReason: "user_lookup" }));
    if (!(await latestSecurity(ids.tokenId))) {
      const reports = await goplus.check(chain, [norm], { excludeHolders: [pair.pairAddress] }).catch(() => null);
      const r = reports?.get(norm);
      if (r) await storeSecurity(ids.tokenId, r);
    }
    found.push({ id: ids.tokenId, chain });
    if (CHAINS[chain].kind === "solana") break;
  }
  return found;
}
