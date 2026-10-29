import { audit } from "@/lib/audit";
import { transaction } from "@/lib/db";

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
