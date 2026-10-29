import { env } from "@/lib/env";
import { ProviderClient, ProviderError } from "./http";

/**
 * Helius `getTransactionsForAddress` (JSON-RPC, available on the free plan).
 * Docs: https://www.helius.dev/docs/rpc/gettransactionsforaddress
 * Full transactions cost 10 credits per 100 returned, so callers page in 100s and cap pages.
 * We read raw pre/post balances rather than a parsed "swap" event, so any DEX or aggregator works.
 */
const rpc = new ProviderClient("helius", "https://mainnet.helius-rpc.com", { perMinute: 120, burst: 5 });

type AccountKey = string | { pubkey: string; signer?: boolean };

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface RawTx {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: AccountKey[]; header?: { numRequiredSignatures: number } };
  };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    logMessages?: string[];
  } | null;
}

export interface FullTx {
  blockTime: number | null;
  transaction: { message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] } };
  meta: { err: unknown; loadedAddresses?: { writable: string[]; readonly: string[] } } | null;
}

/** One transaction by signature (standard RPC, 1 credit). Returns null if it is not available yet. */
export async function getTransaction(signature: string): Promise<FullTx | null> {
  if (!env.heliusApiKey) throw new ProviderError("helius", "HELIUS_API_KEY is not configured");
  const res = await rpc.post<{ result?: FullTx | null; error?: { message?: string } }>(
    `/?api-key=${env.heliusApiKey}`,
    { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }] },
    { timeoutMs: 15_000, retries: 1 },
  );
  if (res.error) throw new ProviderError("helius", res.error.message ?? "RPC error");
  return res.result ?? null;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  if (!env.heliusApiKey) throw new ProviderError("helius", "HELIUS_API_KEY is not configured");
  const res = await rpc.post<{ result?: T; error?: { message?: string } }>(
    `/?api-key=${env.heliusApiKey}`,
    { jsonrpc: "2.0", id: 1, method, params },
    { timeoutMs: 15_000, retries: 1 },
  );
  if (res.error) throw new ProviderError("helius", res.error.message ?? `${method} failed`);
  return res.result as T;
}

/** Newest-first signatures for an address, stopping at `until` (exclusive). Standard RPC, 1 credit. */
export async function getSignatures(address: string, opts: { limit?: number; until?: string | null } = {}) {
  return rpcCall<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]>("getSignaturesForAddress", [
    address,
    { limit: opts.limit ?? 10, commitment: "confirmed", ...(opts.until ? { until: opts.until } : {}) },
  ]);
}

/** One transaction in the RawTx shape used by the swap extractor (1 credit). */
export async function getRawTransaction(signature: string): Promise<RawTx | null> {
  return rpcCall<RawTx | null>("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
}

/** Up to 20 largest token accounts of a mint with UI amounts (1 credit). */
export async function getLargestTokenAccounts(mint: string) {
  const r = await rpcCall<{ value: { address: string; uiAmount: number | null }[] }>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  return r.value;
}

export async function getTokenSupply(mint: string): Promise<number | null> {
  const r = await rpcCall<{ value: { uiAmount: number | null } }>("getTokenSupply", [mint]);
  return r.value.uiAmount;
}

/** Balance of `mint` held by `owner` across its token accounts (1 credit). */
export async function getOwnerTokenBalance(owner: string, mint: string): Promise<number> {
  const r = await rpcCall<{ value: { account: { data: { parsed?: { info?: { tokenAmount?: { uiAmount: number | null } } } } } }[] }>(
    "getTokenAccountsByOwner",
    [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  return r.value.reduce((s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
}

/** Raw account data for up to 100 addresses per call (1 credit per call). Missing accounts map to null. */
export async function getAccounts(addresses: string[]): Promise<Map<string, { owner: string; data: string } | null>> {
  if (!env.heliusApiKey) throw new ProviderError("helius", "HELIUS_API_KEY is not configured");
  const out = new Map<string, { owner: string; data: string } | null>();
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100);
    const res = await rpc.post<{ result?: { value?: ({ owner: string; data: [string, string] } | null)[] }; error?: { message?: string } }>(
      `/?api-key=${env.heliusApiKey}`,
      { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [batch, { encoding: "base64" }] },
      { timeoutMs: 15_000, retries: 1 },
    );
    if (res.error) throw new ProviderError("helius", res.error.message ?? "RPC error");
    const values = res.result?.value ?? [];
    batch.forEach((a, j) => out.set(a, values[j] ? { owner: values[j]!.owner, data: values[j]!.data[0] } : null));
  }
  return out;
}

export interface HistoryPage {
  txs: RawTx[];
  next: string | null;
}

export async function getTransactionsForAddress(
  address: string,
  opts: { sortOrder?: "asc" | "desc"; limit?: number; fromTime?: number; paginationToken?: string | null } = {},
): Promise<HistoryPage> {
  if (!env.heliusApiKey) throw new ProviderError("helius", "HELIUS_API_KEY is not configured");
  const filters: Record<string, unknown> = { status: "succeeded" };
  if (opts.fromTime) filters.blockTime = { gte: opts.fromTime };
  const res = await rpc.post<{ result?: { data?: RawTx[]; paginationToken?: string | null }; error?: { message?: string } }>(
    `/?api-key=${env.heliusApiKey}`,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransactionsForAddress",
      params: [
        address,
        {
          transactionDetails: "full",
          encoding: "json",
          maxSupportedTransactionVersion: 1,
          sortOrder: opts.sortOrder ?? "desc",
          limit: Math.min(100, opts.limit ?? 100),
          filters,
          ...(opts.paginationToken ? { paginationToken: opts.paginationToken } : {}),
        },
      ],
    },
    { timeoutMs: 30_000, retries: 2 },
  );
  if (res.error) throw new ProviderError("helius", res.error.message ?? "RPC error");
  return { txs: res.result?.data ?? [], next: res.result?.paginationToken ?? null };
}

/** Lamports held by an address (1 credit). */
export async function getBalance(address: string): Promise<number> {
  const r = await rpcCall<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return r.value;
}

/** An owner's raw balance of a mint, summed over its token accounts, with the mint's decimals (1 credit). */
export async function getOwnerTokenBalanceRaw(owner: string, mint: string): Promise<{ amount: bigint; decimals: number } | null> {
  const r = await rpcCall<{ value: { account: { data: { parsed?: { info?: { tokenAmount?: { amount: string; decimals: number } } } } } }[] }>(
    "getTokenAccountsByOwner",
    [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  let amount = BigInt(0);
  let decimals: number | null = null;
  for (const a of r.value) {
    const t = a.account.data.parsed?.info?.tokenAmount;
    if (!t) continue;
    amount += BigInt(t.amount);
    decimals = t.decimals;
  }
  return decimals === null ? null : { amount, decimals };
}

/**
 * Simulates a (unsigned) transaction against current state without sending it (1 credit): signatures are not
 * verified and the blockhash is replaced, so any wallet's transaction can be tried. Returns the error, the logs and
 * the lamports of `watch` accounts after the transaction.
 */
export async function simulateTransaction(txBase64: string, watch: string[]): Promise<{ err: unknown; logs: string[]; lamports: (number | null)[] }> {
  const r = await rpcCall<{ value: { err: unknown; logs: string[] | null; accounts: ({ lamports: number } | null)[] | null } }>("simulateTransaction", [
    txBase64,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: watch } },
  ]);
  return { err: r.value.err, logs: r.value.logs ?? [], lamports: (r.value.accounts ?? []).map((a) => a?.lamports ?? null) };
}
