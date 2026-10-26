import { z } from "zod";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getPlan } from "@/lib/billing/plans";
import { stripe } from "@/lib/billing/stripe";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { api, badRequest, enforceRateLimit, ok, parseBody, requireUser } from "@/lib/http";

const schema = z.object({ planId: z.enum(["pro", "elite"]), interval: z.enum(["month", "year"]) });

/**
 * Starts Stripe Checkout. Nothing is unlocked here: access changes only when the signed
 * webhook confirms the subscription.
 */
export const POST = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`checkout:${user.id}`, 10, 600);
  if (!user.emailVerified) throw badRequest("Verify your email address before subscribing.");
  const { planId, interval } = await parseBody(req, schema);
  const plan = await getPlan(planId);
  const price = interval === "year" ? plan?.stripe_price_annual : plan?.stripe_price_monthly;
  if (!plan || !plan.is_active || !price) throw badRequest("This plan is not available for purchase yet.");
  const ent = await getEntitlements(user.id);
  if (ent.subscription?.source === "stripe" && ["active", "trialing", "past_due"].includes(ent.subscription.status)) {
    throw badRequest("You already have an active subscription — change plans from the Billing page instead.");
  }
  const existing = await queryOne<{ provider_customer_id: string }>(
    "SELECT provider_customer_id FROM subscriptions WHERE user_id = $1 AND provider_customer_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
    [user.id],
  );
  const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    ...(existing ? { customer: existing.provider_customer_id } : { customer_email: user.email }),
    client_reference_id: user.id,
    "metadata[user_id]": user.id,
    "subscription_data[metadata][user_id]": user.id,
    "subscription_data[metadata][plan_id]": planId,
    allow_promotion_codes: true,
    success_url: `${env.appUrl}/app/billing?checkout=success`,
    cancel_url: `${env.appUrl}/app/billing?checkout=cancelled`,
  });
  return ok({ url: session.url });
});
