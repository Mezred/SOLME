import { normalizeAddress, type ChainId } from "@/lib/chains";
import { transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { dexscreener } from "@/lib/providers/dexscreener";
import { goplus } from "@/lib/providers/goplus";
import { latestSecurity, storeMarketData, storeSecurity } from "./pipeline";
import { spamReason, worthStoring } from "./spam";

/**
 * On-demand lookup when a user pastes a contract address we are not tracking yet.
 * Fetches real provider data, stores it, and runs a security check. Returns created token ids.
 * `explicit`: the user asked for this exact contract (pasted it or opened a launch), so the minimum-size filter
 * that keeps discovery free of dust is skipped — a fresh bonding-curve coin is still worth checking.
 */
export async function lookupAddress(address: string, chains: ChainId[], opts: { explicit?: boolean } = {}): Promise<{ id: string; chain: ChainId }[]> {
  if (env.demoMode) return [];
  const found: { id: string; chain: ChainId }[] = [];
  for (const chain of chains) {
    const norm = normalizeAddress(chain, address);
    if (!norm) continue;
    const [pair] = await dexscreener.getTokens(chain, [norm]).catch(() => []);
    if (!pair || (!opts.explicit && !worthStoring(pair))) continue;
    const spam = spamReason(pair);
    const ids = await transaction((tx) => storeMarketData(tx, pair, spam, { discoveryReason: "user_lookup" }));
    if (!(await latestSecurity(ids.tokenId))) {
      const reports = await goplus.check(chain, [norm], { excludeHolders: [pair.pairAddress], pools: { [norm]: pair.pairAddress } }).catch(() => null);
      const r = reports?.get(norm);
      if (r) await storeSecurity(ids.tokenId, r);
    }
    found.push({ id: ids.tokenId, chain });
    break; // one chain: the first market found is the coin
  }
  return found;
}
