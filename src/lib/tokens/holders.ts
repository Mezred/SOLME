import type { ChainId } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { env } from "@/lib/env";
import { base58 } from "@/lib/launchpad/pump";
import { getAccounts, getLargestTokenAccounts, getOwnerTokenBalance, getTokenSupply, getTransactionsForAddress, type RawTx } from "@/lib/providers/helius-history";
import { solPriceUsd } from "@/lib/wallets/smart-money";
import { extractSwap } from "@/lib/wallets/scoring";

/**
 * Holder & launch analysis for a Solana token, from Helius RPC (~15 credits, cached CACHE_MINUTES).
 * - Concentration: the 20 largest token accounts, resolved to owners. Owners that are program accounts
 *   (pools, bonding curves, vaults, lockers) are reported separately and excluded from wallet concentration.
 * - Dev: the launchpad creator (or the signer of the token's first transaction) and its current balance.
 * - Launch: buys in the creation slot by wallets other than the creator ("bundle") and buys within the
 *   next SNIPE_SECONDS ("snipers"), as % of supply bought, plus how much those wallets still hold in the top 20.
 * Everything is a snapshot of on-chain state; it does not prove coordination or intent.
 */
const CACHE_MINUTES = 5;
/** Bump when the analysis logic changes so cached reports are recomputed. */
const REPORT_VERSION = 5;
const SNIPE_SECONDS = 10;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export interface HolderRow {
  owner: string;
  pct: number;
  kind: "wallet" | "program";
  isDev: boolean;
  isLaunchBuyer: boolean;
}

export interface HolderReport {
  version?: number;
  computedAt: string;
  supply: number;
  /** How the holder list was built: Solana RPC or GoPlus's top-10 list. Absent on older Solana rows. */
  basis?: "rpc" | "transfers" | "goplus-top10";
  holders: HolderRow[];
  top10WalletPct: number;
  programPct: number;
  dev: { address: string; pct: number; source: "launchpad" | "first_tx" | "creator" } | null;
  launch: { firstAt: string; bundleWallets: number; bundlePct: number; sniperWallets: number; sniperPct: number; devBuyPct: number; launchBuyersHoldPct: number } | null;
}

/** Holder data comes from Helius (HELIUS_API_KEY). */
export function holderDataAvailable(): boolean {
  return Boolean(env.heliusApiKey);
}

/**
 * Fresh reports started by a user (token page, Telegram check) are budgeted, because each costs ~15 Helius credits:
 * per user, and for all users together. Cached reports and background jobs (bounded on their own) are not counted.
 */
export const HOLDER_BUDGET = { perUser: 30, perUserWindowSeconds: 600, global: 120, globalWindowSeconds: 3600 };

export class HolderBudgetError extends Error {}

export async function getHolderReport(chain: ChainId, address: string, opts: { force?: boolean; budgetUserId?: string } = {}): Promise<HolderReport | null> {
  if (!holderDataAvailable()) return null;
  if (!opts.force) {
    const cached = await queryOne<{ data: HolderReport }>(
      `SELECT data FROM token_holder_analysis
        WHERE chain = $1 AND address = $2 AND computed_at > now() - make_interval(mins => $3) AND (data->>'version')::int = $4`,
      [chain, address, CACHE_MINUTES, REPORT_VERSION],
    );
    if (cached) return cached.data;
  }
  if (opts.budgetUserId) {
    const mine = await rateLimit(`holders:user:${opts.budgetUserId}`, HOLDER_BUDGET.perUser, HOLDER_BUDGET.perUserWindowSeconds);
    if (!mine.allowed) throw new HolderBudgetError(`holder checks limited to ${HOLDER_BUDGET.perUser} per ${HOLDER_BUDGET.perUserWindowSeconds / 60} min, try again shortly`);
    const all = await rateLimit("holders:global", HOLDER_BUDGET.global, HOLDER_BUDGET.globalWindowSeconds);
    if (!all.allowed) throw new HolderBudgetError("holder checks are busy right now, try again in a few minutes");
  }
  const computed = await computeHolderReport(address);
  // Rebasing / reflection tokens report balances that exceed their supply; percentages would be meaningless.
  if (computed && computed.holders.reduce((s, h) => s + h.pct, 0) > 100.5) {
    throw new Error("Holder balances exceed the reported supply (rebasing or reflection token), so concentration can't be measured");
  }
  const report = computed ? { ...computed, version: REPORT_VERSION } : null;
  if (report) {
    await query(
      `INSERT INTO token_holder_analysis (chain, address, computed_at, data) VALUES ($1, $2, now(), $3)
       ON CONFLICT (chain, address) DO UPDATE SET computed_at = now(), data = EXCLUDED.data`,
      [chain, address, JSON.stringify(report)],
    );
  }
  return report;
}

async function computeHolderReport(mint: string): Promise<HolderReport | null> {
  const [supply, largest, firstPage, launchpad, solUsd] = await Promise.all([
    getTokenSupply(mint),
    getLargestTokenAccounts(mint),
    getTransactionsForAddress(mint, { sortOrder: "asc" }),
    queryOne<{ creator: string }>("SELECT creator FROM launchpad_tokens WHERE mint = $1", [mint]),
    solPriceUsd(),
  ]);
  if (!supply || supply <= 0) return null;

  // Token account -> owner (bytes 32..64 of an SPL / Token-2022 account), then owner -> wallet or program.
  const tokenAccounts = await getAccounts(largest.map((l) => l.address));
  const ownerOf = new Map<string, string>();
  for (const [addr, a] of tokenAccounts) if (a) ownerOf.set(addr, base58(Buffer.from(a.data, "base64").subarray(32, 64)));
  const owners = [...new Set(ownerOf.values())];
  const ownerAccounts = owners.length ? await getAccounts(owners) : new Map<string, { owner: string } | null>();
  const isProgram = (o: string) => {
    const a = ownerAccounts.get(o);
    return Boolean(a && a.owner !== SYSTEM_PROGRAM);
  };

  const launch = analyseLaunch(mint, firstPage.txs, supply, solUsd);
  const dev = launchpad?.creator ? { address: launchpad.creator, source: "launchpad" as const } : launch?.creator ? { address: launch.creator, source: "first_tx" as const } : null;

  const byOwner = new Map<string, number>();
  for (const l of largest) {
    const o = ownerOf.get(l.address);
    if (o) byOwner.set(o, (byOwner.get(o) ?? 0) + (l.uiAmount ?? 0));
  }
  const holders: HolderRow[] = [...byOwner]
    .map(([owner, amount]) => ({
      owner,
      pct: (amount / supply) * 100,
      kind: isProgram(owner) ? ("program" as const) : ("wallet" as const),
      isDev: owner === dev?.address,
      isLaunchBuyer: launch?.buyers.has(owner) ?? false,
    }))
    .sort((a, b) => b.pct - a.pct);

  const wallets = holders.filter((h) => h.kind === "wallet");
  const devPct = dev ? (holders.find((h) => h.owner === dev.address)?.pct ?? ((await getOwnerTokenBalance(dev.address, mint)) / supply) * 100) : null;

  return {
    computedAt: new Date().toISOString(),
    supply,
    basis: "rpc",
    holders,
    top10WalletPct: wallets.slice(0, 10).reduce((s, h) => s + h.pct, 0),
    programPct: holders.filter((h) => h.kind === "program").reduce((s, h) => s + h.pct, 0),
    dev: dev && devPct !== null ? { address: dev.address, pct: devPct, source: dev.source } : null,
    launch: launch
      ? {
          firstAt: new Date(launch.firstAt * 1000).toISOString(),
          bundleWallets: launch.bundleWallets,
          bundlePct: launch.bundlePct,
          sniperWallets: launch.sniperWallets,
          sniperPct: launch.sniperPct,
          devBuyPct: launch.devBuyPct,
          launchBuyersHoldPct: wallets.filter((h) => h.isLaunchBuyer).reduce((s, h) => s + h.pct, 0),
        }
      : null,
  };
}

/** Pure: launch-slot and early-buy breakdown from the mint's first transactions (oldest first). */
export function analyseLaunch(mint: string, txs: RawTx[], supply: number, solUsd: number | null) {
  const first = txs.find((t) => t.blockTime && !t.meta?.err);
  if (!first?.blockTime) return null;
  const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);
  const creator = keyOf(first.transaction.message.accountKeys[0]);
  const buyers = new Set<string>();
  const bundle = new Map<string, number>();
  const snipers = new Map<string, number>();
  let devBuy = 0;
  for (const tx of txs) {
    if (!tx.blockTime || tx.blockTime - first.blockTime > SNIPE_SECONDS) continue;
    const signer = keyOf(tx.transaction.message.accountKeys[0]);
    const swap = extractSwap(signer, tx, solUsd);
    if (swap?.side !== "buy" || swap.mint !== mint) continue;
    if (signer === creator) {
      devBuy += swap.tokenAmount;
      continue;
    }
    buyers.add(signer);
    const target = tx.slot === first.slot ? bundle : snipers;
    target.set(signer, (target.get(signer) ?? 0) + swap.tokenAmount);
  }
  const pct = (m: Map<string, number>) => ([...m.values()].reduce((s, v) => s + v, 0) / supply) * 100;
  return {
    creator,
    firstAt: first.blockTime,
    buyers,
    bundleWallets: bundle.size,
    bundlePct: pct(bundle),
    sniperWallets: snipers.size,
    sniperPct: pct(snipers),
    devBuyPct: (devBuy / supply) * 100,
  };
}
