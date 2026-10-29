import { isChainId } from "@/lib/chains";
import { queryOne } from "@/lib/db";
import { getHolderReport, type HolderReport } from "@/lib/tokens/holders";
import { investigate, type Investigation } from "@/lib/tokens/investigate";
import { errorMessage, logger } from "@/lib/log";
import { WATCH_MIN_SCORE } from "@/lib/wallets/smart-money";
import type { DecisionInput } from "./verdict";

/** What the decision needs beyond market data: holders, the creator's record and sells, smart-wallet buys. Fails soft. */
export interface DecisionEvidence {
  holders: HolderReport | null;
  holderError: string | null;
  smartBuys: { wallets: number; sol: number; last: Date | null };
  dev: { launches: number; migrated: number; score: number | null } | null;
  /** % of supply the creator sold, from recorded dev sells or launch buy minus current balance. */
  devSoldPct: number | null;
  /** Sell simulation, connected holders, pool depth, trading patterns. */
  investigation: Investigation | null;
}

const log = logger("evidence");

/** `userId`: who asked, for the holder-check budget (see HOLDER_BUDGET). */
export async function loadDecisionEvidence(t: { chain: string; address: string; is_demo: boolean }, userId?: string): Promise<DecisionEvidence> {
  const [holders, smartBuys, dev, sells] = await Promise.all([
    !t.is_demo && isChainId(t.chain) ? getHolderReport(t.chain, t.address, { budgetUserId: userId }).then((r) => ({ r, e: null as string | null })).catch((e: unknown) => ({ r: null, e: e instanceof Error ? e.message : String(e) })) : Promise.resolve({ r: null, e: null }),
    queryOne<{ wallets: number; sol: number | null; last: Date | null }>(
      `SELECT count(DISTINCT x.wallet_id)::int AS wallets, sum((x.raw->>'sol')::numeric) AS sol, max(x.block_time) AS last
         FROM wallet_transactions x JOIN wallet_scores s ON s.wallet_id = x.wallet_id
        WHERE x.chain = $1 AND x.token_address = $2 AND x.direction = 'buy' AND x.provider = 'helius-rpc'
          AND x.block_time > now() - interval '24 hours' AND s.score >= $3 AND NOT s.bot_like`,
      [t.chain, t.address, WATCH_MIN_SCORE],
    ),
    !t.is_demo
      ? queryOne<{ launches: number; migrated: number; score: number | null }>(
          `SELECT d.launches, d.migrated, d.score FROM launchpad_tokens l JOIN dev_profiles d ON d.creator = l.creator WHERE l.mint = $1`,
          [t.address],
        )
      : Promise.resolve(null),
    queryOne<{ pct: number | null }>("SELECT sum(supply_pct)::float AS pct FROM dev_sells WHERE mint = $1", [t.address]),
  ]);
  const h = holders.r;
  // The investigation reuses the holder list (sell-test wallets, holders to trace), so it runs after it.
  const investigation =
    !t.is_demo && isChainId(t.chain)
      ? await investigate(t.chain, t.address, h, { budgetUserId: userId }).catch((err: unknown) => {
          log.warn("Investigation failed", { address: t.address, error: errorMessage(err) });
          return null;
        })
      : null;
  // A launchpad creator who bought at launch and now holds less has sold the difference (transfers out look the same).
  // Only for launchpad coins: elsewhere the first "buy" is usually the liquidity deposit, not a dev bag.
  const fromBalance = h?.launch && h.dev?.source === "launchpad" && h.launch.devBuyPct <= 100 ? Math.max(0, h.launch.devBuyPct - h.dev.pct) : null;
  const recorded = sells?.pct ?? null;
  const devSoldPct = fromBalance === null && recorded === null ? null : Math.min(100, Math.max(fromBalance ?? 0, recorded ?? 0));
  return {
    holders: h,
    holderError: holders.e,
    smartBuys: { wallets: smartBuys?.wallets ?? 0, sol: Number(smartBuys?.sol ?? 0), last: smartBuys?.last ?? null },
    dev,
    devSoldPct,
    investigation,
  };
}


/** The decision input's evidence fields, from loaded evidence. */
export function evidenceInput(ev: DecisionEvidence): Pick<DecisionInput, "holders" | "dev" | "devSoldPct" | "smartWallets" | "investigation"> {
  const h = ev.holders;
  return {
    holders: h
      ? {
          top10WalletPct: h.top10WalletPct,
          devPct: h.dev?.pct ?? null,
          bundlePct: h.launch?.bundlePct ?? null,
          launchBuyersHoldPct: h.launch?.launchBuyersHoldPct ?? null,
          sniperPct: h.launch?.sniperPct ?? null,
          devBuyPct: h.launch?.devBuyPct ?? null,
        }
      : null,
    dev: ev.dev,
    devSoldPct: ev.devSoldPct,
    smartWallets: { wallets: ev.smartBuys.wallets, sol: ev.smartBuys.sol },
    investigation: ev.investigation,
  };
}

/** Reads the security row's failed checks as short labels for the gate. */
export function failedCheckLabels(checks: unknown): string[] {
  return checkLabels(checks, "fail");
}

/** The security row's warnings (what makes a contract "medium risk"), as short labels. */
export function warnCheckLabels(checks: unknown): string[] {
  return checkLabels(checks, "warn");
}

function checkLabels(checks: unknown, result: "fail" | "warn"): string[] {
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((c): c is { label: string; result: string; detail?: string } => !!c && typeof c === "object" && (c as { result?: unknown }).result === result)
    .map((c) => (c.detail ? `${c.label}: ${c.detail}` : c.label));
}
