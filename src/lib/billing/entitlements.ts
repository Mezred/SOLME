import { queryOne } from "@/lib/db";
import { getPlan, type PlanFeatures } from "./plans";
import { upgradeRequired } from "@/lib/http";
import type { ChainId } from "@/lib/chains";

/** Days of continued access while Stripe retries a failed renewal (status past_due). */
export const PAST_DUE_GRACE_DAYS = 3;

export interface Entitlements {
  planId: string;
  planName: string;
  features: PlanFeatures;
  subscription: {
    id: string;
    status: string;
    source: string;
    interval: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  inGracePeriod: boolean;
}

/**
 * The single source of truth for paid access. Only rows written by verified webhooks or audited
 * admin grants can raise a user above Free; nothing the browser sends is trusted.
 */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const sub = await queryOne<{
    id: string;
    plan_id: string;
    status: string;
    source: string;
    billing_interval: string | null;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
  }>(
    `SELECT id, plan_id, status, source, billing_interval, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE user_id = $1
        AND (
          (status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
          OR (status = 'past_due' AND current_period_end + make_interval(days => $2) > now())
        )
      ORDER BY (SELECT sort_order FROM subscription_plans p WHERE p.id = plan_id) DESC, updated_at DESC
      LIMIT 1`,
    [userId, PAST_DUE_GRACE_DAYS],
  );

  const plan = (sub && (await getPlan(sub.plan_id))) || (await getPlan("free"));
  if (!plan) throw new Error("Free plan is missing from subscription_plans");
  return {
    planId: plan.id,
    planName: plan.name,
    features: plan.features,
    subscription: sub
      ? {
          id: sub.id,
          status: sub.status,
          source: sub.source,
          interval: sub.billing_interval,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        }
      : null,
    inGracePeriod: sub?.status === "past_due",
  };
}

export function assertFeature(ent: Entitlements, feature: keyof PlanFeatures, label: string) {
  if (!ent.features[feature]) throw upgradeRequired(`${label} is not included in the ${ent.planName} plan.`);
}

export function assertChain(ent: Entitlements, chain: ChainId) {
  if (!ent.features.chains.includes(chain))
    throw upgradeRequired(`${chain.toUpperCase()} access is not included in the ${ent.planName} plan.`);
}
