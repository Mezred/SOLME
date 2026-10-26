import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { getPlan } from "@/lib/billing/plans";
import { stripe, type StripeSubscription } from "@/lib/billing/stripe";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { api, badRequest, enforceRateLimit, notFound, ok, parseBody, requireUser } from "@/lib/http";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("portal") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("change"), planId: z.enum(["pro", "elite"]), interval: z.enum(["month", "year"]) }),
]);

/**
 * Subscription management. Each action calls Stripe; our database is updated only by the resulting
 * signed webhook (customer.subscription.updated), never directly from this request.
 */
export const POST = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`billing:${user.id}`, 10, 600);
  const body = await parseBody(req, schema);
  const sub = await queryOne<{ provider_subscription_id: string; provider_customer_id: string; plan_id: string }>(
    `SELECT provider_subscription_id, provider_customer_id, plan_id FROM subscriptions
      WHERE user_id = $1 AND source = 'stripe' AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused')
      ORDER BY updated_at DESC LIMIT 1`,
    [user.id],
  );
  if (!sub) throw notFound("No active Stripe subscription found.");
  const ip = await clientIp();

  if (body.action === "portal") {
    const s = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: sub.provider_customer_id, return_url: `${env.appUrl}/app/billing` });
    return ok({ url: s.url });
  }
  if (body.action === "cancel" || body.action === "resume") {
    await stripe("POST", `/subscriptions/${sub.provider_subscription_id}`, { cancel_at_period_end: body.action === "cancel" });
    await audit(user.id, `billing.${body.action}_requested`, { type: "subscription", id: sub.provider_subscription_id }, {}, ip);
    return ok({ ok: true, pending: "Your subscription will update as soon as Stripe confirms the change." });
  }
  // Plan change (upgrade/downgrade) with proration.
  const plan = await getPlan(body.planId);
  const price = body.interval === "year" ? plan?.stripe_price_annual : plan?.stripe_price_monthly;
  if (!plan || !price) throw badRequest("That plan is not available.");
  const current = await stripe<StripeSubscription>("GET", `/subscriptions/${sub.provider_subscription_id}`);
  const item = current.items.data[0];
  if (item.price.id === price) throw badRequest("You are already on this plan and interval.");
  await stripe(
    "POST",
    `/subscriptions/${sub.provider_subscription_id}`,
    { "items[0][id]": item.id, "items[0][price]": price, proration_behavior: "create_prorations", cancel_at_period_end: false, "metadata[plan_id]": body.planId },
    `change-${sub.provider_subscription_id}-${price}-${Math.floor(Date.now() / 60_000)}`,
  );
  await audit(user.id, "billing.plan_change_requested", { type: "subscription", id: sub.provider_subscription_id }, { from: sub.plan_id, to: body.planId, interval: body.interval }, ip);
  return ok({ ok: true, pending: "Plan change submitted. Your access updates when Stripe confirms it (usually within seconds)." });
});
