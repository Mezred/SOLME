import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { isUuid, query } from "@/lib/db";
import { api, badRequest, ok, parseBody, requireRole } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, ctx) => {
  const staff = await requireRole("admin", "support");
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const b = await parseBody(req, z.object({ status: z.enum(["open", "pending", "closed"]), admin_note: z.string().max(2000).nullable() }));
  await query("UPDATE support_tickets SET status = $2, admin_note = $3, updated_at = now() WHERE id = $1", [id, b.status, b.admin_note]);
  await audit(staff.id, "admin.support_updated", { type: "ticket", id }, b, await clientIp());
  return ok({ ok: true });
});
