/**
 * Chain registry. SOLME covers Solana only; provider adapters read their chain identifiers from this table rather
 * than hard-coding them. Safe to import from client components (no secrets).
 */
export type ChainId = "solana";

export interface ChainConfig {
  id: ChainId;
  name: string;
  short: string;
  nativeSymbol: string;
  /** Wrapped native token, used for market-regime context. */
  wrappedNative: string;
  dexscreenerId: string;
  geckoterminalId: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
  color: string;
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: "solana",
    name: "Solana",
    short: "SOL",
    nativeSymbol: "SOL",
    wrappedNative: "So11111111111111111111111111111111111111112",
    dexscreenerId: "solana",
    geckoterminalId: "solana",
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
    explorerAddress: (a) => `https://solscan.io/account/${a}`,
    color: "#14F195",
  },
};

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];

export function isChainId(v: unknown): v is ChainId {
  return typeof v === "string" && v in CHAINS;
}

export function chainFromDexscreener(id: string): ChainId | null {
  return CHAIN_IDS.find((c) => CHAINS[c].dexscreenerId === id) ?? null;
}

export function chainFromGeckoterminal(id: string): ChainId | null {
  return CHAIN_IDS.find((c) => CHAINS[c].geckoterminalId === id) ?? null;
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A Solana address as stored (base58 is case-sensitive, kept as-is). Null for malformed input. */
export function normalizeAddress(_chain: ChainId, address: string): string | null {
  const a = address.trim();
  return SOL_ADDR.test(a) ? a : null;
}
