import { query, queryOne } from "@/lib/db";
import type { ChainId } from "@/lib/chains";

export interface PlanFeatures {
  chains: ChainId[];
  signal_feed_limit: number;
  signal_delay_minutes: number;
  signal_history_days: number;
  advanced_filters: boolean;
  max_watchlists: number;
  max_watchlist_items: number;
  max_portfolios: number;
  portfolio_analytics: "basic" | "advanced";
  csv_export: boolean;
  max_alert_rules: number;
  alert_channels: ("in_app" | "email" | "telegram")[];
  ai_daily_requests: number;
  ai_deep_analysis: boolean;
  max_tracked_wallets: number;
  smart_money: boolean;
  whale_alerts: boolean;
  market_intelligence: "basic" | "standard" | "advanced";
  priority_support: boolean;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_annual_cents: number;
  currency: string;
  stripe_price_monthly: string | null;
  stripe_price_annual: string | null;
  features: PlanFeatures;
  sort_order: number;
  is_active: boolean;
}

export async function listPlans(includeInactive = false): Promise<Plan[]> {
  return query<Plan>(
    `SELECT * FROM subscription_plans ${includeInactive ? "" : "WHERE is_active"} ORDER BY sort_order`,
  );
}

export async function getPlan(id: string): Promise<Plan | null> {
  return queryOne<Plan>("SELECT * FROM subscription_plans WHERE id = $1", [id]);
}

/** Human-readable feature rows for pricing tables, derived from the configured entitlements. */
export function featureRows(f: PlanFeatures): string[] {
  const rows = [
    `${f.chains.length} chain${f.chains.length === 1 ? "" : "s"}: ${f.chains.map((c) => c.toUpperCase()).join(", ")}`,
    f.signal_delay_minutes > 0
      ? `Signal feed (latest ${f.signal_feed_limit}, ${f.signal_delay_minutes}-min delay)`
      : `Real-time signal feed (latest ${f.signal_feed_limit})`,
    `${f.signal_history_days}-day signal history`,
    f.advanced_filters ? "Advanced screener filters" : "Basic filters",
    `${f.max_watchlists} watchlist${f.max_watchlists === 1 ? "" : "s"} · ${f.max_watchlist_items} tokens`,
    `${f.max_alert_rules} alert rules (${f.alert_channels.join(", ").replace("in_app", "in-app")})`,
    `${f.ai_daily_requests} AI requests / day${f.ai_deep_analysis ? " · deep analysis" : ""}`,
    `${f.portfolio_analytics === "advanced" ? "Advanced" : "Basic"} portfolio analytics${f.csv_export ? " · CSV export" : ""}`,
  ];
  if (f.max_tracked_wallets > 0) rows.push(`Track ${f.max_tracked_wallets} wallets`);
  if (f.smart_money) rows.push("Smart Money tracking");
  if (f.whale_alerts) rows.push("Whale alerts");
  rows.push(`${f.market_intelligence[0].toUpperCase()}${f.market_intelligence.slice(1)} market intelligence`);
  if (f.priority_support) rows.push("Priority support");
  return rows;
}
