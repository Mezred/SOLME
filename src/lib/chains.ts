/**
 * Chain registry. Adding another EVM network means adding one entry here — provider adapters read
 * their chain identifiers from this table rather than hard-coding them.
 * Safe to import from client components (no secrets).
 */
export type ChainId = "solana" | "ethereum" | "bsc" | "base";

export interface ChainConfig {
  id: ChainId;
  name: string;
  short: string;
  kind: "solana" | "evm";
  evmChainId?: number;
  nativeSymbol: string;
  /** Wrapped native token, used for market-regime context. */
  wrappedNative: string;
  dexscreenerId: string;
  geckoterminalId: string;
  /** GoPlus uses numeric chain IDs for EVM and a dedicated endpoint for Solana. */
  goplusId: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
  color: string;
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  solana: {
    id: "solana",
    name: "Solana",
    short: "SOL",
    kind: "solana",
    nativeSymbol: "SOL",
    wrappedNative: "So11111111111111111111111111111111111111112",
    dexscreenerId: "solana",
    geckoterminalId: "solana",
    goplusId: "solana",
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
    explorerAddress: (a) => `https://solscan.io/account/${a}`,
    color: "#14F195",
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    short: "ETH",
    kind: "evm",
    evmChainId: 1,
    nativeSymbol: "ETH",
    wrappedNative: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    dexscreenerId: "ethereum",
    geckoterminalId: "eth",
    goplusId: "1",
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://etherscan.io/address/${a}`,
    color: "#8A92B2",
  },
  bsc: {
    id: "bsc",
    name: "BNB Smart Chain",
    short: "BSC",
    kind: "evm",
    evmChainId: 56,
    nativeSymbol: "BNB",
    wrappedNative: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    dexscreenerId: "bsc",
    geckoterminalId: "bsc",
    goplusId: "56",
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    explorerAddress: (a) => `https://bscscan.com/address/${a}`,
    color: "#F0B90B",
  },
  base: {
    id: "base",
    name: "Base",
    short: "BASE",
    kind: "evm",
    evmChainId: 8453,
    nativeSymbol: "ETH",
    wrappedNative: "0x4200000000000000000000000000000000000006",
    dexscreenerId: "base",
    geckoterminalId: "base",
    goplusId: "8453",
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
    color: "#3B82F6",
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

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Normalizes a contract address for identity: EVM addresses are lower-cased (checksums are
 * presentation only), Solana base58 addresses are case-sensitive and kept as-is.
 * Returns null for malformed input.
 */
export function normalizeAddress(chain: ChainId, address: string): string | null {
  const a = address.trim();
  if (CHAINS[chain].kind === "evm") return EVM_ADDR.test(a) ? a.toLowerCase() : null;
  return SOL_ADDR.test(a) ? a : null;
}
