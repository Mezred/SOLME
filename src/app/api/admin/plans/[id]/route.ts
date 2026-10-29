import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { CHAIN_IDS } from "@/lib/chains";
import { query, queryOne } from "@/lib/db";
import { api, notFound, ok, parseBody, requireAdmin } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const features = z.object({
  chains: z.array(z.enum(CHAIN_IDS as [string, ...string[]])).min(1),
  advanced_filters: z.boolean(),
  max_watchlists: z.number().int().min(1).max(1000),
  max_watchlist_items: z.number().int().min(1).max(100000),
  max_portfolios: z.number().int().min(1).max(1000),
  portfolio_analytics: z.enum(["basic", "advanced"]),
  csv_export: z.boolean(),
  max_alert_rules: z.number().int().min(0).max(10000),
  alert_channels: z.array(z.enum(["in_app", "email", "telegram"])).min(1),
  ai_daily_requests: z.number().int().min(0).max(100000),
  ai_deep_analysis: z.boolean(),
  max_tracked_wallets: z.number().int().min(0).max(100000),
  smart_money: z.boolean(),
  whale_alerts: z.boolean(),
  market_intelligence: z.enum(["basic", "standard", "advanced"]),
  priority_support: z.boolean(),
});

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200),
  price_monthly_cents: z.number().int().min(0).max(10_000_000),
  price_annual_cents: z.number().int().min(0).max(100_000_000),
  is_active: z.boolean(),
  features,
});

export const PUT = api<Ctx>(async (req, ctx) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const before = await queryOne("SELECT * FROM subscription_plans WHERE id = $1", [id]);
  if (!before) throw notFound("Plan not found");
  const b = await parseBody(req, schema);
  await query(
    `UPDATE subscription_plans SET name = $2, description = $3, price_monthly_cents = $4, price_annual_cents = $5,
       is_active = $6, features = $7, updated_at = now() WHERE id = $1`,
    [id, b.name, b.description, b.price_monthly_cents, b.price_annual_cents, id === "free" ? true : b.is_active, JSON.stringify(b.features)],
  );
  await audit(admin.id, "admin.plan_updated", { type: "plan", id }, { before, after: b }, await clientIp());
  return ok({ ok: true });
});
