import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { getEntitlements } from "@/lib/billing/entitlements";
import { verifyStripeSignature } from "@/lib/billing/stripe";
import { processStripeEvent, type StripeEvent } from "@/lib/billing/webhooks";

const SECRET = "whsec_test_secret";
const sign = (payload: string, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ id: "evt_1" });
  it("accepts a valid signature", () => expect(verifyStripeSignature(body, sign(body), SECRET)).toBe(true));
  it("rejects a tampered payload", () => expect(verifyStripeSignature(body + " ", sign(body), SECRET)).toBe(false));
  it("rejects the wrong secret", () => expect(verifyStripeSignature(body, sign(body, undefined, "whsec_other"), SECRET)).toBe(false));
  it("rejects stale timestamps (replay)", () => expect(verifyStripeSignature(body, sign(body, Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false));
  it("rejects missing headers", () => expect(verifyStripeSignature(body, null, SECRET)).toBe(false));
});

let db: Database;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  [{ id: userId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('payer@test.dev') RETURNING id");
  await db.query("UPDATE subscription_plans SET stripe_price_monthly = 'price_pro_m', stripe_price_annual = 'price_pro_y' WHERE id = 'pro'");
  await db.query("UPDATE subscription_plans SET stripe_price_monthly = 'price_elite_m' WHERE id = 'elite'");
});
afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

const subEvent = (id: string, type: string, status: string, price = "price_pro_m", endOffsetSec = 30 * 86400): StripeEvent => ({
  id,
  type,
  data: {
    object: {
      id: "sub_123",
      customer: "cus_1",
      status,
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: { user_id: userId },
      items: { data: [{ id: "si_1", price: { id: price, recurring: { interval: "month" } }, current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + endOffsetSec }] },
    },
  },
});

describe("Stripe webhook processing & entitlements", () => {
  it("starts on Free", async () => {
    expect((await getEntitlements(userId)).planId).toBe("free");
  });

  it("activates Pro only from a verified subscription event", async () => {
    expect(await processStripeEvent(subEvent("evt_a", "customer.subscription.created", "active"))).toBe("processed");
    const ent = await getEntitlements(userId);
    expect(ent.planId).toBe("pro");
    expect(ent.features.advanced_filters).toBe(true);
  });

  it("is idempotent for duplicate deliveries", async () => {
    expect(await processStripeEvent(subEvent("evt_a", "customer.subscription.created", "active"))).toBe("duplicate");
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM payment_events WHERE event_id = 'evt_a'");
    expect(n).toBe(1);
  });

  it("upgrades to Elite on subscription update", async () => {
    await processStripeEvent(subEvent("evt_b", "customer.subscription.updated", "active", "price_elite_m"));
    expect((await getEntitlements(userId)).planId).toBe("elite");
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1", [userId]);
    expect(n).toBe(1);
  });

  it("keeps access during the past_due grace period, then drops to Free", async () => {
    await processStripeEvent(subEvent("evt_c", "customer.subscription.updated", "past_due", "price_elite_m", -86400));
    let ent = await getEntitlements(userId);
    expect(ent.planId).toBe("elite");
    expect(ent.inGracePeriod).toBe(true);
    await processStripeEvent(subEvent("evt_d", "customer.subscription.updated", "past_due", "price_elite_m", -10 * 86400));
    ent = await getEntitlements(userId);
    expect(ent.planId).toBe("free");
  });

  it("revokes access when the subscription is canceled", async () => {
    await processStripeEvent(subEvent("evt_e", "customer.subscription.updated", "active"));
    expect((await getEntitlements(userId)).planId).toBe("pro");
    await processStripeEvent(subEvent("evt_f", "customer.subscription.deleted", "canceled"));
    expect((await getEntitlements(userId)).planId).toBe("free");
  });

  it("rejects unknown prices instead of guessing a plan, and records the failure", async () => {
    await expect(processStripeEvent(subEvent("evt_g", "customer.subscription.updated", "active", "price_unknown"))).rejects.toThrow(/Unknown Stripe price/);
    const [ev] = await db.query<{ status: string }>("SELECT status FROM payment_events WHERE event_id = 'evt_g'");
    expect(ev.status).toBe("failed");
    expect((await getEntitlements(userId)).planId).toBe("free");
  });

  it("ignores unrelated event types", async () => {
    expect(await processStripeEvent({ id: "evt_h", type: "customer.created", data: { object: {} } })).toBe("ignored");
  });
});
