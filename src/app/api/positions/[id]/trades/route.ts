import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser } from "@/lib/http";
import { tradeSchema } from "@/lib/portfolio/schemas";
import { syncPositionStatus } from "@/lib/portfolio/sync";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const t = await parseBody(req, tradeSchema);
  await withUser(user.id, async (tx) => {
    const [pos] = await tx.query("SELECT id FROM positions WHERE id = $1", [id]);
    if (!pos) throw notFound("Position not found");
    await tx.query(
      "INSERT INTO trades (position_id, user_id, side, quantity, price, fee, executed_at, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, user.id, t.side, t.quantity, t.price, t.fee, t.executedAt, t.note ?? null],
    );
    await syncPositionStatus(tx, id); // throws (and rolls back) on oversell
  });
  return ok({ ok: true }, { status: 201 });
});

export const DELETE = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const tradeId = new URL(req.url).searchParams.get("tradeId");
  if (!isUuid(id) || !isUuid(tradeId)) throw badRequest("Invalid id");
  await withUser(user.id, async (tx) => {
    const del = await tx.query("DELETE FROM trades WHERE id = $1 AND position_id = $2 RETURNING id", [tradeId, id]);
    if (!del.length) throw notFound("Trade not found");
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM trades WHERE position_id = $1", [id]);
    if (n === 0) await tx.query("DELETE FROM positions WHERE id = $1", [id]);
    else await syncPositionStatus(tx, id);
  });
  return ok({ ok: true });
});
