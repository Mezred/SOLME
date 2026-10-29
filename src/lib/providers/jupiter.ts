import { ProviderClient, ProviderError } from "./http";

/**
 * Jupiter swap API (free tier, no key): best route and price for a swap, and the unsigned swap transaction for a
 * wallet. SOLME only uses it to *simulate* sells (never sends a transaction). Docs: https://dev.jup.ag/docs/swap
 */
const jup = new ProviderClient("jupiter", process.env.JUPITER_API_BASE ?? "https://lite-api.jup.ag/swap/v1", { perMinute: 50, burst: 5 });
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  swapUsdValue?: string;
  routePlan: { swapInfo: { label?: string } }[];
  [k: string]: unknown;
}

/** Quote for selling `amount` base units of `mint` for SOL; null when Jupiter has no route. */
export async function quoteSell(mint: string, amount: bigint, slippageBps = 1000): Promise<JupQuote | null> {
  // 400 = no route / token not tradable on Jupiter.
  const q = await jup.get<(JupQuote & { error?: string }) | null>(
    `/quote?inputMint=${mint}&outputMint=${WSOL_MINT}&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`,
    { timeoutMs: 12_000, retries: 1, nullOn: [400, 404] },
  );
  return !q || q.error || !q.outAmount ? null : q;
}

/** The unsigned swap transaction (base64) for `wallet` to execute `quote`. */
export async function buildSwap(quote: JupQuote, wallet: string): Promise<string> {
  const r = await jup.post<{ swapTransaction?: string; error?: string }>(
    "/swap",
    { quoteResponse: quote, userPublicKey: wallet, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 0 },
    { timeoutMs: 15_000, retries: 1 },
  );
  if (!r.swapTransaction) throw new ProviderError("jupiter", r.error ?? "No swap transaction returned");
  return r.swapTransaction;
}
