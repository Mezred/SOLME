import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, requireUser } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid id");
  const rows = await withUser(user.id, async (tx) => {
    // Its alert goes with it.
    await tx.query("DELETE FROM alert_rules WHERE rule_type = 'screener_match' AND params->>'template_id' = $1", [id]);
    return tx.query("DELETE FROM screener_templates WHERE id = $1 RETURNING id", [id]);
  });
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});
