import { CHAINS, normalizeAddress, type ChainId } from "@/lib/chains";
import { env } from "@/lib/env";
import { ProviderClient } from "./http";
import type { WalletActivityProvider, WalletTransaction } from "./types";

/**
 * Wallet activity adapters. Both require API keys and are disabled (reported as "unconfigured")
 * without them. Directions are derived only from transfers involving the wallet: we report
 * buy/sell solely for Solana SWAP transactions where the wallet both sends and receives;
 * everything else is transfer_in / transfer_out. We do not infer intent beyond that.
 *
 * NOTE: implemented against the providers' documented request formats; response parsing is
 * defensive because these adapters could not be exercised without credentials during development.
 */

// Quote assets we skip when deciding which token a swap was "about".
const SOL_QUOTES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const helius = new ProviderClient(
  "helius",
  process.env.HELIUS_API_BASE ?? "https://api-mainnet.helius-rpc.com",
  { perMinute: 60, burst: 5 },
);

interface HeliusTx {
  signature?: string;
  timestamp?: number;
  type?: string;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
}

export function parseHeliusTransactions(wallet: string, txs: HeliusTx[]): WalletTransaction[] {
  const out: WalletTransaction[] = [];
  for (const tx of txs) {
    if (!tx.signature || !tx.timestamp) continue;
    const transfers = (tx.tokenTransfers ?? []).filter((t) => t.mint && !SOL_QUOTES.has(t.mint));
    const isSwap = tx.type === "SWAP";
    for (const t of transfers) {
      const incoming = t.toUserAccount === wallet;
      const outgoing = t.fromUserAccount === wallet;
      if (!incoming && !outgoing) continue;
      out.push({
        txHash: tx.signature,
        blockTime: new Date(tx.timestamp * 1000),
        direction: isSwap ? (incoming ? "buy" : "sell") : incoming ? "transfer_in" : "transfer_out",
        tokenAddress: t.mint ?? null,
        tokenSymbol: null,
        amount: typeof t.tokenAmount === "number" ? t.tokenAmount : null,
        amountUsd: null,
        counterparty: (incoming ? t.fromUserAccount : t.toUserAccount) ?? null,
        raw: { type: tx.type },
      });
    }
  }
  return out;
}

export const heliusWallets: WalletActivityProvider = {
  name: "helius",
  supports: (chain) => chain === "solana",
  configured: () => Boolean(env.heliusApiKey),
  async getTransactions(chain, address, limit = 50) {
    if (!env.heliusApiKey) throw new Error("HELIUS_API_KEY is not configured");
    const res = await helius.get<HeliusTx[]>(
      `/v0/addresses/${address}/transactions?api-key=${env.heliusApiKey}&limit=${Math.min(100, limit)}`,
      { cacheSeconds: 60 },
    );
    return parseHeliusTransactions(address, Array.isArray(res) ? res : []);
  },
};

// Alchemy network slugs. BNB Smart Chain is omitted: alchemy_getAssetTransfers support for it is not documented.
const ALCHEMY_NETWORK: Partial<Record<ChainId, string>> = { ethereum: "eth-mainnet", base: "base-mainnet" };
const alchemyClients = new Map<string, ProviderClient>();
function alchemyClient(net: string) {
  let c = alchemyClients.get(net);
  if (!c) {
    c = new ProviderClient("alchemy", `https://${net}.g.alchemy.com/v2`, { perMinute: 120, burst: 10 });
    alchemyClients.set(net, c);
  }
  return c;
}

interface AlchemyTransfer {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: number | null;
  asset?: string | null;
  rawContract?: { address?: string | null };
  metadata?: { blockTimestamp?: string };
}

export function parseAlchemyTransfers(chain: ChainId, wallet: string, transfers: AlchemyTransfer[]): WalletTransaction[] {
  const w = wallet.toLowerCase();
  return transfers
    .filter((t) => t.hash && t.metadata?.blockTimestamp)
    .map((t) => {
      const incoming = t.to?.toLowerCase() === w;
      return {
        txHash: t.hash!,
        blockTime: new Date(t.metadata!.blockTimestamp!),
        direction: incoming ? "transfer_in" : "transfer_out",
        tokenAddress: t.rawContract?.address ? normalizeAddress(chain, t.rawContract.address) : null,
        tokenSymbol: t.asset ?? null,
        amount: typeof t.value === "number" ? t.value : null,
        amountUsd: null,
        counterparty: (incoming ? t.from : t.to) ?? null,
        raw: null,
      } satisfies WalletTransaction;
    });
}

export const alchemyWallets: WalletActivityProvider = {
  name: "alchemy",
  supports: (chain) => CHAINS[chain].kind === "evm" && chain in ALCHEMY_NETWORK,
  configured: () => Boolean(env.alchemyApiKey),
  async getTransactions(chain, address, limit = 50) {
    if (!env.alchemyApiKey) throw new Error("ALCHEMY_API_KEY is not configured");
    const net = ALCHEMY_NETWORK[chain];
    if (!net) throw new Error(`Alchemy transfers are not supported for ${chain}`);
    const maxCount = `0x${Math.min(100, limit).toString(16)}`;
    const call = async (dir: "fromAddress" | "toAddress") => {
      const res = await alchemyClient(net).post<{ result?: { transfers?: AlchemyTransfer[] } }>(
        `/${env.alchemyApiKey}`,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [{ [dir]: address, category: ["erc20"], withMetadata: true, order: "desc", maxCount, excludeZeroValue: true }],
        },
        { cacheSeconds: 60 },
      );
      return res.result?.transfers ?? [];
    };
    const [sent, received] = await Promise.all([call("fromAddress"), call("toAddress")]);
    return parseAlchemyTransfers(chain, address, [...sent, ...received])
      .sort((a, b) => b.blockTime.getTime() - a.blockTime.getTime())
      .slice(0, limit);
  },
};

export function walletProviderFor(chain: ChainId): WalletActivityProvider | null {
  return [heliusWallets, alchemyWallets].find((p) => p.supports(chain)) ?? null;
}
