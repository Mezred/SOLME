import { z } from "zod";
import { CHAIN_IDS } from "@/lib/chains";

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
  signal_score: z.object({
    min_score: z.number().int().min(0).max(100),
    signal_types: z.array(z.enum(["momentum", "accumulation", "breakout_watch", "distribution", "high_risk"])).optional(),
  }),
  security_warning: z.object({ min_level: z.enum(["medium", "high", "critical"]) }),
  wallet_activity: z.object({ directions: z.array(z.enum(["buy", "sell", "transfer_in", "transfer_out"])).optional() }),
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
  signal_score: "New signal above score",
  security_warning: "Security warning",
  wallet_activity: "Tracked wallet activity",
};

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
    if (v.rule_type === "wallet_activity" && !v.wallet_id) ctx.addIssue({ code: "custom", path: ["wallet_id"], message: "Choose a tracked wallet" });
  });
