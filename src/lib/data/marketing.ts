import { featureRows, listPlans } from "@/lib/billing/plans";
import type { PricingPlan } from "@/components/marketing/pricing-cards";

export async function getPricingPlans(): Promise<PricingPlan[]> {
  const plans = await listPlans();
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    monthly: p.price_monthly_cents,
    annual: p.price_annual_cents,
    currency: p.currency,
    rows: featureRows(p.features),
  }));
}
