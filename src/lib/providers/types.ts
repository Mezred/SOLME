import type { ChainId } from "@/lib/chains";

/** Normalized market data for a token's primary trading pair. Any field may be null when unavailable. */
export interface MarketPairData {
  chain: ChainId;
  tokenAddress: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  pairAddress: string;
  dexId: string | null;
  quoteSymbol: string | null;
  quoteAddress: string | null;
  url: string | null;
  pairCreatedAt: Date | null;
  priceUsd: number | null;
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null; d7: number | null };
  volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  liquidityUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  txns: {
    m5: { buys: number; sells: number } | null;
    h1: { buys: number; sells: number } | null;
    h24: { buys: number; sells: number } | null;
  };
  websites: string[];
  socials: { type: string; url: string }[];
  /** True when the listing has paid promotion (e.g. DexScreener boosts). Promotion is not a quality signal. */
  promoted: boolean;
  source: string;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleTimeframe = "15m" | "1h" | "4h" | "1d";

export interface DiscoveryCandidate {
  chain: ChainId;
  address: string;
  reason: "trending" | "new_pool" | "boosted" | "profile";
  source: string;
}

export type CheckResult = "pass" | "warn" | "fail" | "unavailable";

export interface SecurityCheck {
  key: string;
  label: string;
  result: CheckResult;
  detail: string;
}

export interface SecurityReport {
  provider: string;
  checkedAt: Date;
  /** 'unavailable' means the provider returned nothing — never treat it as a clean report. */
  status: "complete" | "partial" | "unavailable" | "error";
  riskLevel: "low" | "medium" | "high" | "critical" | "unknown";
  checks: SecurityCheck[];
  unavailable: string[];
  limitations: string;
  holderCount: number | null;
  top10HolderPct: number | null;
  raw: unknown;
}

export interface WalletTransaction {
  txHash: string;
  blockTime: Date;
  direction: "buy" | "sell" | "transfer_in" | "transfer_out" | "other";
  tokenAddress: string | null;
  tokenSymbol: string | null;
  amount: number | null;
  amountUsd: number | null;
  counterparty: string | null;
  raw: unknown;
}

export interface MarketDataProvider {
  name: string;
  getTokens(chain: ChainId, addresses: string[]): Promise<MarketPairData[]>;
  search(q: string): Promise<MarketPairData[]>;
}

export interface DiscoveryProvider {
  name: string;
  discover(chains: ChainId[]): Promise<DiscoveryCandidate[]>;
}

export interface CandleProvider {
  name: string;
  getCandles(chain: ChainId, pairAddress: string, timeframe: CandleTimeframe, limit?: number): Promise<Candle[]>;
}

export interface SecurityProvider {
  name: string;
  check(chain: ChainId, addresses: string[], context?: { excludeHolders?: string[] }): Promise<Map<string, SecurityReport>>;
}

export interface WalletActivityProvider {
  name: string;
  supports(chain: ChainId): boolean;
  configured(): boolean;
  getTransactions(chain: ChainId, address: string, limit?: number): Promise<WalletTransaction[]>;
}
