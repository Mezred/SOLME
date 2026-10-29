import type { Entitlements } from "@/lib/billing/entitlements";
import type { AlertType } from "./rules";

/**
 * The few alerts that serve the three jobs, as one-click switches on the Alerts page. Each is an ordinary
 * alert rule tagged with params.preset, so the engine, limits and delivery work exactly as for custom rules.
 */
export interface AlertPreset {
  key: string;
  title: string;
  detail: string;
  rule_type: AlertType;
  params: Record<string, unknown>;
  /** What the plan must include: smart-wallet data (Elite), wallet alerts (Pro+), or a launchpad chain. */
  needs: "smart_money" | "wallets" | "launchpad" | null;
}

export const ALERT_PRESETS: AlertPreset[] = [
  {
    key: "smart_buy",
    title: "A smart wallet buys a coin that passes the scam check",
    detail: "Wallet score 70+, buy of 0.5 SOL or more, full check on the coin (contract, exit, holders, bundle).",
    rule_type: "smart_wallet_buy",
    params: { min_wallet_score: 70, min_buy_sol: 0.5, pass_check: true },
    needs: "smart_money",
  },
  {
    key: "group_buy",
    title: "3+ smart wallets buy the same coin within 10 minutes",
    detail: "Wallets scoring 60+. Much stronger than a single buy; still check the coin before you buy.",
    rule_type: "smart_group_buy",
    params: { min_wallets: 3, window_minutes: 10, min_wallet_score: 60 },
    needs: "smart_money",
  },
  {
    key: "followed_buy",
    title: "A wallet you follow buys a coin that passes the scam check",
    detail: "Any buy by a wallet you follow on Smart Wallets.",
    rule_type: "smart_wallet_buy",
    params: { min_wallet_score: 1, min_buy_sol: 0, pass_check: true, followed_only: true },
    needs: "wallets",
  },
  {
    key: "followed_all",
    title: "Every buy and sell by wallets you follow",
    detail: "Any coin, scam check or not, within seconds. Shows SOL, price, market cap and the result of sells.",
    rule_type: "wallet_activity",
    params: { directions: ["buy", "sell", "transfer_out"] },
    needs: "wallets",
  },
  {
    key: "proven_dev",
    title: "A proven dev launches a new coin",
    detail: "Creators whose earlier launches migrated (dev score 60+). A good record does not make a launch safe.",
    rule_type: "dev_deploy",
    params: { min_dev_score: 60 },
    needs: "launchpad",
  },
];

/** Why the plan cannot switch this preset on (shown on the switch), or null. */
export function presetLock(p: AlertPreset, ent: Entitlements): string | null {
  if (p.needs === "smart_money" && !ent.features.smart_money) return "Elite";
  if (p.needs === "wallets" && ent.features.max_tracked_wallets === 0) return "Pro";
  if ((p.needs === "smart_money" || p.needs === "wallets") && !ent.features.chains.includes("solana")) return "Needs Solana";
  if (p.needs === "launchpad" && !ent.features.chains.includes("solana")) return "Needs Solana";
  return null;
}
