import type { ChainId } from "@/lib/chains";
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

export function walletProviderFor(chain: ChainId): WalletActivityProvider | null {
  return heliusWallets.supports(chain) ? heliusWallets : null;
}
