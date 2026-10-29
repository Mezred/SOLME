import { z } from "zod";
import { cleanParams, listTemplates, MAX_TEMPLATES } from "@/lib/data/screener-templates";
import { withUser } from "@/lib/db";
import { api, badRequest, ok, parseBody, requireUser } from "@/lib/http";

export const GET = api(async () => {
  const user = await requireUser();
  return ok({ templates: await listTemplates(user.id) });
});

const create = z.object({
  name: z.string().trim().min(1).max(60),
  params: z.record(z.string(), z.string().max(200)),
});

/** Saves the current filters under a name; saving again with the same name overwrites it. */
export const POST = api(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, create);
  const params = cleanParams(body.params);
  if (!Object.keys(params).length) throw badRequest("Set at least one filter before saving a template.");
  return withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM screener_templates WHERE name <> $1", [body.name]);
    if (n >= MAX_TEMPLATES) throw badRequest(`You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`);
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO screener_templates (user_id, name, params) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE SET params = EXCLUDED.params, updated_at = now() RETURNING id`,
      [user.id, body.name, JSON.stringify(params)],
    );
    return ok({ id: row.id }, { status: 201 });
  });
});
