import { z } from "zod";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  is_active: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  channels: z.array(z.enum(["in_app", "email", "telegram"])).min(1).optional(),
  cooldown_minutes: z.number().int().min(1).max(10080).optional(),
});

export const PATCH = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const b = await parseBody(req, patch);
  if (b.channels) {
    const ent = await getEntitlements(user.id);
    if (b.channels.some((c) => !ent.features.alert_channels.includes(c))) throw upgradeRequired("That channel is not included in your plan.");
  }
  const rows = await withUser(user.id, (tx) =>
    tx.query(
      `UPDATE alert_rules SET is_active = COALESCE($2, is_active), name = COALESCE($3, name),
         channels = COALESCE($4, channels), cooldown_minutes = COALESCE($5, cooldown_minutes) WHERE id = $1 RETURNING id`,
      [id, b.is_active ?? null, b.name ?? null, b.channels ?? null, b.cooldown_minutes ?? null],
    ),
  );
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const rows = await withUser(user.id, (tx) => tx.query("DELETE FROM alert_rules WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});
