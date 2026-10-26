import { CHAINS, chainFromGeckoterminal, normalizeAddress, type ChainId } from "@/lib/chains";
import { ProviderClient } from "./http";
import type { Candle, CandleProvider, CandleTimeframe, DiscoveryCandidate, DiscoveryProvider } from "./types";

/**
 * GeckoTerminal public API (no key). Docs: https://www.geckoterminal.com/dex-api
 * Free tier is ~30 calls/min; we stay under it. Used for OHLCV candles and trending/new pool discovery.
 */
// Observed in production: the keyless tier returns 429 well below the documented 30/min, so we stay at ~10/min.
const gt = new ProviderClient("geckoterminal", "https://api.geckoterminal.com/api/v2", { perMinute: 10, burst: 2 }, {
  Accept: "application/json;version=20230302",
});

const TF: Record<CandleTimeframe, { unit: "minute" | "hour" | "day"; aggregate: number }> = {
  "15m": { unit: "minute", aggregate: 15 },
  "1h": { unit: "hour", aggregate: 1 },
  "4h": { unit: "hour", aggregate: 4 },
  "1d": { unit: "day", aggregate: 1 },
};

interface GtPool {
  id: string;
  attributes: { address: string };
  relationships?: { base_token?: { data?: { id: string } } };
}

function tokenFromRelId(relId: string | undefined): { chain: ChainId; address: string } | null {
  if (!relId) return null;
  const idx = relId.indexOf("_");
  const chain = chainFromGeckoterminal(relId.slice(0, idx));
  if (!chain) return null;
  const address = normalizeAddress(chain, relId.slice(idx + 1));
  return address ? { chain, address } : null;
}

export const geckoterminal: CandleProvider & DiscoveryProvider = {
  name: "geckoterminal",

  async getCandles(chain, pairAddress, timeframe, limit = 200) {
    const { unit, aggregate } = TF[timeframe];
    const res = await gt.get<{ data?: { attributes?: { ohlcv_list?: number[][] } } } | null>(
      `/networks/${CHAINS[chain].geckoterminalId}/pools/${pairAddress}/ohlcv/${unit}?aggregate=${aggregate}&limit=${limit}&currency=usd`,
      { cacheSeconds: 300, nullOn: [404], retries: 1 },
    );
    const list = res?.data?.attributes?.ohlcv_list ?? [];
    return list
      .map(([time, open, high, low, close, volume]): Candle => ({ time, open, high, low, close, volume }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
  },

  async discover(chains) {
    const out: DiscoveryCandidate[] = [];
    for (const chain of chains) {
      const net = CHAINS[chain].geckoterminalId;
      for (const [path, reason] of [
        [`/networks/${net}/trending_pools?page=1`, "trending"],
        [`/networks/${net}/new_pools?page=1`, "new_pool"],
      ] as const) {
        const res = await gt.get<{ data?: GtPool[] }>(path, { cacheSeconds: 300, retries: 1 }).catch(() => ({ data: [] }));
        for (const pool of res.data ?? []) {
          const t = tokenFromRelId(pool.relationships?.base_token?.data?.id);
          if (t && t.address !== CHAINS[t.chain].wrappedNative) out.push({ ...t, reason, source: "geckoterminal" });
        }
      }
    }
    return out;
  },
};
