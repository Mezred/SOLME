import { query, queryOne } from "@/lib/db";
import type { ChainId } from "@/lib/chains";

export interface PlanFeatures {
  chains: ChainId[];
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

/** Short feature rows for pricing cards, derived from the configured entitlements (only what the product shows). */
export function featureRows(f: PlanFeatures): string[] {
  const telegram = f.alert_channels.includes("telegram");
  const rows = [
    "Scam check on any coin",
    `${f.max_alert_rules} alerts${telegram ? " · Telegram & email" : " · in-app"}`,
    f.smart_money ? "Smart wallets + proven-dev launches" : f.max_tracked_wallets > 0 ? `Follow ${f.max_tracked_wallets} wallets` : "",
    f.priority_support ? "Priority support" : "",
  ];
  return rows.filter(Boolean);
}
