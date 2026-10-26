import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser } from "@/lib/http";
import { positionPatchSchema } from "@/lib/portfolio/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const b = await parseBody(req, positionPatchSchema);
  const rows = await withUser(user.id, (tx) =>
    tx.query(
      `UPDATE positions SET
         stop_loss = CASE WHEN $2::boolean THEN $3 ELSE stop_loss END,
         take_profits = COALESCE($4::jsonb, take_profits),
         notes = CASE WHEN $5::boolean THEN $6 ELSE notes END,
         updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, b.stopLoss !== undefined, b.stopLoss ?? null, b.takeProfits ? JSON.stringify(b.takeProfits) : null, b.notes !== undefined, b.notes ?? null],
    ),
  );
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const rows = await withUser(user.id, (tx) => tx.query("DELETE FROM positions WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});
