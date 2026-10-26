import { z } from "zod";
import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const b = await parseBody(req, z.object({ custom_label: z.string().trim().max(60).nullable().optional(), alerts_enabled: z.boolean().optional() }));
  const rows = await withUser(user.id, (tx) =>
    tx.query(
      `UPDATE user_tracked_wallets SET custom_label = CASE WHEN $2::boolean THEN $3 ELSE custom_label END, alerts_enabled = COALESCE($4, alerts_enabled)
       WHERE wallet_id = $1 RETURNING wallet_id`,
      [id, b.custom_label !== undefined, b.custom_label ?? null, b.alerts_enabled ?? null],
    ),
  );
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  await withUser(user.id, async (tx) => {
    await tx.query("DELETE FROM alert_rules WHERE wallet_id = $1", [id]);
    const rows = await tx.query("DELETE FROM user_tracked_wallets WHERE wallet_id = $1 RETURNING wallet_id", [id]);
    if (!rows.length) throw notFound();
  });
  return ok({ ok: true });
});
