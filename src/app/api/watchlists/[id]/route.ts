import { z } from "zod";
import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(60) }));
  const rows = await withUser(user.id, (tx) => tx.query("UPDATE watchlists SET name = $2 WHERE id = $1 RETURNING id", [id, name]));
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const rows = await withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM watchlists");
    if (n <= 1) throw badRequest("You need at least one watchlist.");
    return tx.query("DELETE FROM watchlists WHERE id = $1 RETURNING id", [id]);
  });
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});
