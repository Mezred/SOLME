import { audit } from "@/lib/audit";
import { query, queryOne, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { stripe, type StripeSubscription } from "./stripe";

const log = logger("billing");

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const STATUSES = new Set(["trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]);

/** Maps a Stripe price to our plan id. Unknown prices are rejected — we never guess entitlements. */
async function planForPrice(priceId: string) {
  return queryOne<{ id: string; interval: string }>(
    `SELECT id, CASE WHEN stripe_price_annual = $1 THEN 'year' ELSE 'month' END AS interval
       FROM subscription_plans WHERE stripe_price_monthly = $1 OR stripe_price_annual = $1`,
    [priceId],
  );
}

async function userForSubscription(sub: StripeSubscription): Promise<string | null> {
  if (sub.metadata?.user_id) {
    const u = await queryOne<{ id: string }>("SELECT id FROM users WHERE id::text = $1", [sub.metadata.user_id]);
    if (u) return u.id;
  }
  const s = await queryOne<{ user_id: string }>("SELECT user_id FROM subscriptions WHERE provider_customer_id = $1 ORDER BY updated_at DESC LIMIT 1", [sub.customer]);
  return s?.user_id ?? null;
}

/** Upserts our subscription row from Stripe's authoritative subscription object. */
export async function syncSubscription(sub: StripeSubscription, eventId: string): Promise<string | null> {
  const item = sub.items?.data?.[0];
  if (!item) throw new Error(`Subscription ${sub.id} has no items`);
  const plan = await planForPrice(item.price.id);
  if (!plan) throw new Error(`Unknown Stripe price ${item.price.id}; configure it in Admin → Pricing`);
  const userId = await userForSubscription(sub);
  if (!userId) throw new Error(`Cannot resolve user for subscription ${sub.id}`);
  if (!STATUSES.has(sub.status)) throw new Error(`Unexpected subscription status ${sub.status}`);
  // Newer API versions moved billing periods onto subscription items.
  const start = item.current_period_start ?? sub.current_period_start ?? null;
  const end = item.current_period_end ?? sub.current_period_end ?? null;
  const interval = item.price.recurring?.interval === "year" ? "year" : plan.interval;
  await query(
    `INSERT INTO subscriptions (user_id, plan_id, source, provider_customer_id, provider_subscription_id, billing_interval, status,
                                current_period_start, current_period_end, cancel_at_period_end, canceled_at, updated_at)
     VALUES ($1, $2, 'stripe', $3, $4, $5, $6, to_timestamp($7), to_timestamp($8), $9, to_timestamp($10), now())
     ON CONFLICT (provider_subscription_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id, billing_interval = EXCLUDED.billing_interval, status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, canceled_at = EXCLUDED.canceled_at, updated_at = now()`,
    [userId, plan.id, sub.customer, sub.id, interval, sub.status, start, end, sub.cancel_at_period_end, sub.canceled_at],
  );
  await audit(null, "billing.subscription_synced", { type: "user", id: userId }, { subscription: sub.id, plan: plan.id, status: sub.status, event: eventId });
  return userId;
}

/** Re-fetches the subscription from Stripe so out-of-order webhooks can't regress state. */
async function fetchSubscription(id: string, fallback?: StripeSubscription): Promise<StripeSubscription> {
  if (!env.stripeSecretKey && fallback) return fallback;
  return stripe<StripeSubscription>("GET", `/subscriptions/${id}`);
}

/**
 * Processes a verified Stripe event exactly once. Duplicate deliveries of an already-processed event
 * are acknowledged without side effects; failed events can be retried by Stripe.
 */
export async function processStripeEvent(event: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const inserted = await queryOne<{ id: string; status: string }>(
    `INSERT INTO payment_events (provider, event_id, event_type, payload) VALUES ('stripe', $1, $2, $3)
     ON CONFLICT (provider, event_id) DO UPDATE SET event_type = EXCLUDED.event_type
     RETURNING id, status`,
    [event.id, event.type, JSON.stringify(event)],
  );
  if (inserted && (inserted.status === "processed" || inserted.status === "ignored")) return "duplicate";

  const obj = event.data.object;
  let userId: string | null = null;
  let amount: number | null = null;
  let currency: string | null = null;
  let outcome: "processed" | "ignored" = "processed";
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const subId = obj.subscription as string | null;
        if (obj.mode !== "subscription" || !subId) {
          outcome = "ignored";
          break;
        }
        const sub = await fetchSubscription(subId);
        // Attach metadata user from the session if the subscription lacks it.
        if (!sub.metadata?.user_id && obj.client_reference_id) sub.metadata = { ...sub.metadata, user_id: String(obj.client_reference_id) };
        userId = await syncSubscription(sub, event.id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const sub = await fetchSubscription(obj.id as string, obj as unknown as StripeSubscription);
        userId = await syncSubscription(sub, event.id);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        amount = typeof obj.amount_paid === "number" && event.type === "invoice.paid" ? obj.amount_paid : (obj.amount_due as number) ?? null;
        currency = (obj.currency as string) ?? null;
        const subId = (obj.subscription as string | null) ?? ((obj.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription ?? null);
        if (subId) {
          const sub = await fetchSubscription(subId);
          userId = await syncSubscription(sub, event.id);
        } else {
          const s = await queryOne<{ user_id: string }>("SELECT user_id FROM subscriptions WHERE provider_customer_id = $1 LIMIT 1", [obj.customer]);
          userId = s?.user_id ?? null;
        }
        if (event.type === "invoice.payment_failed" && userId) {
          await query(
            `INSERT INTO notifications (user_id, channel, title, body, link, status, sent_at)
             VALUES ($1, 'in_app', 'Payment failed', 'We could not charge your payment method. Update it in Billing to keep your plan; access continues during a short grace period.', '/app/billing', 'sent', now())`,
            [userId],
          );
        }
        break;
      }
      default:
        outcome = "ignored";
    }
    await query(
      "UPDATE payment_events SET status = $2, user_id = $3, amount_cents = $4, currency = $5, processed_at = now(), error = NULL WHERE provider = 'stripe' AND event_id = $1",
      [event.id, outcome, userId, amount, currency],
    );
    return outcome;
  } catch (err) {
    await query("UPDATE payment_events SET status = 'failed', error = $2 WHERE provider = 'stripe' AND event_id = $1", [event.id, errorMessage(err).slice(0, 1000)]);
    log.error("Stripe event processing failed", { event: event.id, type: event.type, error: errorMessage(err) });
    throw err;
  }
}

/** Admin grant: an audited, manual entitlement (e.g. support credit). Not a payment. */
export async function grantPlan(adminId: string, userId: string, planId: string, days: number, ip: string | null) {
  await transaction(async (tx) => {
    await tx.query("UPDATE subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now() WHERE user_id = $1 AND source = 'admin_grant' AND status = 'active'", [userId]);
    if (planId !== "free") {
      await tx.query(
        `INSERT INTO subscriptions (user_id, plan_id, source, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'admin_grant', 'active', now(), now() + make_interval(days => $3))`,
        [userId, planId, days],
      );
    }
  });
  await audit(adminId, "admin.plan_granted", { type: "user", id: userId }, { planId, days }, ip);
}
