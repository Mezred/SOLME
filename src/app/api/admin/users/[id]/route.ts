import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp, revokeAllSessions } from "@/lib/auth/session";
import { grantPlan } from "@/lib/billing/webhooks";
import { isUuid, query, queryOne } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireAdmin } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), role: z.enum(["user", "support", "admin"]) }),
  z.object({ action: z.literal("status"), status: z.enum(["active", "disabled"]) }),
  z.object({ action: z.literal("verify_email") }),
  z.object({ action: z.literal("revoke_sessions") }),
  z.object({ action: z.literal("grant_plan"), planId: z.enum(["free", "pro", "elite"]), days: z.number().int().min(1).max(3650) }),
]);

const ROLE_IDS = { user: 1, support: 2, admin: 3 } as const;

export const PATCH = api<Ctx>(async (req, ctx) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const target = await queryOne<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1", [id]);
  if (!target) throw notFound("User not found");
  const body = await parseBody(req, schema);
  const ip = await clientIp();
  if (id === admin.id && (body.action === "role" || body.action === "status")) throw badRequest("You cannot change your own role or status.");

  switch (body.action) {
    case "role":
      await query("UPDATE users SET role_id = $2, updated_at = now() WHERE id = $1", [id, ROLE_IDS[body.role]]);
      await revokeAllSessions(id);
      break;
    case "status":
      await query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [id, body.status]);
      if (body.status === "disabled") await revokeAllSessions(id);
      break;
    case "verify_email":
      await query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [id]);
      break;
    case "revoke_sessions":
      await revokeAllSessions(id);
      break;
    case "grant_plan":
      await grantPlan(admin.id, id, body.planId, body.days, ip);
      return ok({ ok: true });
  }
  await audit(admin.id, `admin.user_${body.action}`, { type: "user", id }, { ...body, email: target.email }, ip);
  return ok({ ok: true });
});
