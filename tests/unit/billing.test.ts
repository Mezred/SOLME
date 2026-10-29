import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { getEntitlements } from "@/lib/billing/entitlements";
import { grantPlan } from "@/lib/billing/grants";

describe("entitlements", () => {
  it("starts on Free", async () => {
    expect((await getEntitlements(userId)).planId).toBe("free");
  });

  it("an admin grant raises the plan for its duration and is audited", async () => {
    await grantPlan(adminId, userId, "pro", 7, null);
    const ent = await getEntitlements(userId);
    expect(ent.planId).toBe("pro");
    expect(ent.features.advanced_filters).toBe(true);
    expect(ent.subscription?.source).toBe("admin_grant");
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'admin.plan_granted'");
    expect(n).toBe(1);
  });

  it("a new grant replaces the previous one, and granting Free revokes it", async () => {
    await grantPlan(adminId, userId, "elite", 7, null);
    expect((await getEntitlements(userId)).planId).toBe("elite");
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1 AND status = 'active'", [userId]);
    expect(n).toBe(1);
    await grantPlan(adminId, userId, "free", 0, null);
    expect((await getEntitlements(userId)).planId).toBe("free");
  });

  it("a crypto plan counts only until its paid period ends", async () => {
    await db.query(
      `INSERT INTO subscriptions (user_id, plan_id, source, billing_interval, status, current_period_start, current_period_end)
       VALUES ($1, 'pro', 'crypto', 'month', 'active', now() - interval '31 days', now() - interval '1 day')`,
      [userId],
    );
    expect((await getEntitlements(userId)).planId).toBe("free");
    await db.query("UPDATE subscriptions SET current_period_end = now() + interval '1 day' WHERE user_id = $1 AND source = 'crypto'", [userId]);
    expect((await getEntitlements(userId)).planId).toBe("pro");
  });

  it("the highest active plan wins when several overlap", async () => {
    await grantPlan(adminId, userId, "elite", 3, null);
    expect((await getEntitlements(userId)).planId).toBe("elite");
  });

  it("legacy card subscriptions no longer unlock anything", async () => {
    const [{ id: other }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('legacy@test.dev') RETURNING id");
    await db.query(
      `INSERT INTO subscriptions (user_id, plan_id, source, status, current_period_end) VALUES ($1, 'elite', 'stripe', 'canceled', now() + interval '20 days')`,
      [other],
    );
    expect((await getEntitlements(other)).planId).toBe("free");
  });
});

let db: Database;
let userId: string;
let adminId: string;

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  [{ id: userId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('payer@test.dev') RETURNING id");
  [{ id: adminId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('admin@test.dev') RETURNING id");
});
afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});
