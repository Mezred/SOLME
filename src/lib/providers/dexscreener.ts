import { CHAINS, chainFromDexscreener, normalizeAddress, type ChainId } from "@/lib/chains";
import { ProviderClient } from "./http";
import type { DiscoveryCandidate, DiscoveryProvider, MarketDataProvider, MarketPairData } from "./types";

/**
 * DexScreener public API (no key). Docs: https://docs.dexscreener.com/api/reference
 * Limits: 300 req/min for pair/token endpoints, 60 req/min for profile/boost endpoints.
 * Provides m5/h1/h6/h24 price change, volume, txn counts, liquidity, FDV, market cap, pair age.
 * Does NOT provide: 7-day change, holder counts, unique traders.
 */
const pairs = new ProviderClient("dexscreener", "https://api.dexscreener.com", { perMinute: 240, burst: 20 });
const meta = new ProviderClient("dexscreener", "https://api.dexscreener.com", { perMinute: 50, burst: 5 });

interface DsPair {
  chainId: string;
  dexId?: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
  boosts?: { active?: number };
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

export function mapDexscreenerPair(p: DsPair): MarketPairData | null {
  const chain = chainFromDexscreener(p.chainId);
  if (!chain) return null;
  const address = normalizeAddress(chain, p.baseToken.address);
  if (!address) return null;
  const tx = (k: string) => (p.txns?.[k] ? { buys: p.txns[k].buys ?? 0, sells: p.txns[k].sells ?? 0 } : null);
  return {
    chain,
    tokenAddress: address,
    symbol: (p.baseToken.symbol ?? "?").slice(0, 32),
    name: (p.baseToken.name ?? "Unknown").slice(0, 120),
    logoUrl: p.info?.imageUrl ?? null,
    pairAddress: p.pairAddress,
    dexId: p.dexId ?? null,
    quoteSymbol: p.quoteToken?.symbol ?? null,
    quoteAddress: p.quoteToken?.address ?? null,
    url: p.url ?? null,
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt) : null,
    priceUsd: n(p.priceUsd),
    priceChange: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24), d7: null },
    volume: { m5: n(p.volume?.m5), h1: n(p.volume?.h1), h6: n(p.volume?.h6), h24: n(p.volume?.h24) },
    liquidityUsd: n(p.liquidity?.usd),
    marketCap: n(p.marketCap),
    fdv: n(p.fdv),
    txns: { m5: tx("m5"), h1: tx("h1"), h24: tx("h24") },
    websites: (p.info?.websites ?? []).map((w) => w.url).filter(Boolean),
    socials: (p.info?.socials ?? []).filter((s) => s?.url),
    promoted: (p.boosts?.active ?? 0) > 0,
    source: "dexscreener",
  };
}

/** Picks the deepest-liquidity pair where the token is the base asset. */
export function pickPrimaryPairs(list: MarketPairData[]): Map<string, MarketPairData> {
  const best = new Map<string, MarketPairData>();
  for (const p of list) {
    const key = `${p.chain}:${p.tokenAddress}`;
    const cur = best.get(key);
    if (!cur || (p.liquidityUsd ?? 0) > (cur.liquidityUsd ?? 0)) best.set(key, p);
  }
  return best;
}

export const dexscreener: MarketDataProvider & DiscoveryProvider = {
  name: "dexscreener",

  async getTokens(chain: ChainId, addresses: string[]) {
    const out: MarketPairData[] = [];
    const wanted = new Set(addresses);
    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30);
      const res = await pairs.get<DsPair[]>(`/tokens/v1/${CHAINS[chain].dexscreenerId}/${batch.join(",")}`, {
        cacheSeconds: 30,
      });
      for (const p of res ?? []) {
        const m = mapDexscreenerPair(p);
        if (m && wanted.has(m.tokenAddress)) out.push(m);
      }
    }
    return [...pickPrimaryPairs(out).values()];
  },

  async search(q: string) {
    const res = await pairs.get<{ pairs: DsPair[] | null }>(`/latest/dex/search?q=${encodeURIComponent(q)}`, {
      cacheSeconds: 30,
    });
    const mapped = (res.pairs ?? []).map(mapDexscreenerPair).filter((x): x is MarketPairData => x !== null);
    return [...pickPrimaryPairs(mapped).values()];
  },

  async discover(chains: ChainId[]) {
    const want = new Set(chains);
    const out: DiscoveryCandidate[] = [];
    const sources: [string, DiscoveryCandidate["reason"]][] = [
      ["/token-boosts/top/v1", "boosted"],
      ["/token-boosts/latest/v1", "boosted"],
      ["/token-profiles/latest/v1", "profile"],
    ];
    for (const [path, reason] of sources) {
      const list = await meta.get<{ chainId: string; tokenAddress: string }[]>(path, { cacheSeconds: 60 }).catch(() => []);
      for (const item of list ?? []) {
        const chain = chainFromDexscreener(item.chainId);
        if (!chain || !want.has(chain)) continue;
        const address = normalizeAddress(chain, item.tokenAddress);
        if (address) out.push({ chain, address, reason, source: "dexscreener" });
      }
    }
    return out;
  },
};
