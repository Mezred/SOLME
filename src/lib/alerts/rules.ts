import { z } from "zod";
import { CHAIN_IDS } from "@/lib/chains";

/** Set on rules created from an alert preset (src/lib/alerts/presets.ts). */
const preset = z.string().max(40).optional();

/** Validated parameter schemas per alert type. Shared by API validation and the UI. */
export const ALERT_PARAM_SCHEMAS = {
  price_above: z.object({ price: z.number().positive() }),
  price_below: z.object({ price: z.number().positive() }),
  price_change: z.object({
    window: z.enum(["m5", "h1", "h24"]),
    pct: z.number().positive().max(10_000),
    direction: z.enum(["up", "down", "either"]),
  }),
  volume_spike: z.object({ multiple: z.number().min(1.5).max(100) }),
  liquidity_drop: z.object({ pct: z.number().min(5).max(100) }),
  security_warning: z.object({ min_level: z.enum(["medium", "high", "critical"]) }),
  // One followed wallet (wallet_id), or every wallet the user follows (no wallet_id). Any coin, checked or not.
  wallet_activity: z.object({
    directions: z.array(z.enum(["buy", "sell", "transfer_in", "transfer_out"])).optional(),
    // Buys and sells smaller than this are skipped (0 = all).
    min_sol: z.number().min(0).max(1000).optional(),
    // Buys only: alert only when the coin passes the scam check (sells always alert).
    pass_check: z.boolean().optional(),
    preset,
  }),
  // Launchpad (Solana) and smart-wallet alerts. Dev score is judged as it stood when the token launched.
  dev_deploy: z.object({ min_dev_score: z.number().int().min(1).max(100), preset }),
  curve_progress: z.object({ min_progress: z.number().int().min(50).max(99), min_dev_score: z.number().int().min(0).max(100) }),
  smart_wallet_buy: z.object({
    min_wallet_score: z.number().int().min(1).max(100),
    min_buy_sol: z.number().min(0).max(1000),
    // Run the full scam check on the coin and alert only when it passes.
    pass_check: z.boolean().optional(),
    // Only wallets this user follows (any score).
    followed_only: z.boolean().optional(),
    preset,
  }),
  // Several smart wallets buy the same coin within a few minutes.
  smart_group_buy: z.object({
    min_wallets: z.number().int().min(2).max(10),
    window_minutes: z.number().int().min(2).max(60),
    min_wallet_score: z.number().int().min(1).max(100),
    preset,
  }),
  // A coin newly matches one of the user's saved Screener templates (switched on from the Screener).
  screener_match: z.object({ template_id: z.string().uuid() }),
} as const;

export type AlertType = keyof typeof ALERT_PARAM_SCHEMAS;
export const ALERT_TYPES = Object.keys(ALERT_PARAM_SCHEMAS) as AlertType[];

/** Rule types that apply to one token and therefore require token_id. */
export const TOKEN_RULES: AlertType[] = ["price_above", "price_below", "price_change", "volume_spike", "liquidity_drop", "security_warning"];

export const ALERT_LABELS: Record<AlertType, string> = {
  price_above: "Price crosses above",
  price_below: "Price crosses below",
  price_change: "Price moves by %",
  volume_spike: "Volume spike",
  liquidity_drop: "Liquidity drop",
  security_warning: "Security warning",
  wallet_activity: "Followed wallet trades",
  dev_deploy: "Proven dev launches a token",
  curve_progress: "Bonding curve reaches %",
  smart_wallet_buy: "Smart wallet buys",
  screener_match: "Screener template matches",
  smart_group_buy: "Several smart wallets buy the same coin",
};

/** Human-readable condition for a rule's params (alerts list). Unknown shapes fall back to key: value. */
export function describeAlertParams(type: string, p: Record<string, unknown>): string {
  const n = (k: string) => Number(p[k]);
  switch (type) {
    case "price_above": return `price ≥ $${n("price")}`;
    case "price_below": return `price ≤ $${n("price")}`;
    case "price_change": return `${p.direction === "either" ? "±" : p.direction === "up" ? "+" : "−"}${n("pct")}% over ${String(p.window).replace("m5", "5m").replace("h1", "1h").replace("h24", "24h")}`;
    case "volume_spike": return `1h volume ≥ ${n("multiple")}× the 24h average`;
    case "liquidity_drop": return `liquidity falls ≥ ${n("pct")}% in 1h`;
    case "security_warning": return `risk level ≥ ${String(p.min_level)}`;
    case "wallet_activity": return `${Array.isArray(p.directions) && p.directions.length ? p.directions.join(", ").replaceAll("_", " ") : "any activity"}${n("min_sol") > 0 ? ` · ≥ ${n("min_sol")} SOL` : ""}${p.pass_check ? " · buys must pass the scam check" : ""}`;
    case "dev_deploy": return `dev score ≥ ${n("min_dev_score")} at launch`;
    case "curve_progress": return `curve ≥ ${n("min_progress")}%${n("min_dev_score") > 0 ? ` · dev score ≥ ${n("min_dev_score")}` : " · any dev"}`;
    case "screener_match": return "a new coin matches the saved filters";
    case "smart_group_buy": return `${n("min_wallets")}+ wallets scoring ${n("min_wallet_score")}+ within ${n("window_minutes")} min`;
    case "smart_wallet_buy": return `${p.followed_only ? "followed wallets" : `wallet score ≥ ${n("min_wallet_score")}`}${n("min_buy_sol") > 0 ? ` · buy ≥ ${n("min_buy_sol")} SOL` : ""}${p.pass_check ? " · scam check passed" : ""}`;
    default: return Object.entries(p).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join(" · ") || "any";
  }
}

/** Event-style rule types: every new event fires once (deduplicated), so cooldown never hides them. */
export const EVENT_RULES: AlertType[] = ["wallet_activity", "dev_deploy", "curve_progress", "smart_wallet_buy", "screener_match", "smart_group_buy"];
/** Created from another page (not the custom alert form). */
export const MANAGED_RULES: AlertType[] = ["screener_match", "smart_group_buy"];
/** Rule types evaluated by the fast (~15s) launchpad alert job as well as the regular cycle. */
export const FAST_RULES: AlertType[] = ["dev_deploy", "curve_progress", "smart_wallet_buy", "smart_group_buy", "wallet_activity"];

export const alertRuleInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    rule_type: z.enum(ALERT_TYPES as [AlertType, ...AlertType[]]),
    chain: z.enum(CHAIN_IDS as [string, ...string[]]).nullable().optional(),
    token_id: z.string().uuid().nullable().optional(),
    wallet_id: z.string().uuid().nullable().optional(),
    params: z.record(z.string(), z.unknown()),
    channels: z.array(z.enum(["in_app", "email", "telegram"])).min(1),
    cooldown_minutes: z.number().int().min(1).max(10080).default(60),
  })
  .superRefine((v, ctx) => {
    const parsed = ALERT_PARAM_SCHEMAS[v.rule_type].safeParse(v.params);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: ["params"], message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if (TOKEN_RULES.includes(v.rule_type) && !v.token_id) ctx.addIssue({ code: "custom", path: ["token_id"], message: "This alert type needs a token" });
  });
