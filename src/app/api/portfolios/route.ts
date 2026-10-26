import { z } from "zod";
import { getEntitlements } from "@/lib/billing/entitlements";
import { withUser } from "@/lib/db";
import { loadPortfolio } from "@/lib/data/portfolio";
import { api, ApiError, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";

export const GET = api(async (req) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  const data = await loadPortfolio(user.id, id);
  return ok(data);
});

export const POST = api(async (req) => {
  const user = await requireUser();
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(60) }));
  const ent = await getEntitlements(user.id);
  return withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM portfolios");
    if (n >= ent.features.max_portfolios) throw upgradeRequired(`Your plan allows ${ent.features.max_portfolios} portfolio(s).`);
    const [row] = await tx.query<{ id: string }>("INSERT INTO portfolios (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id", [user.id, name]);
    if (!row) throw new ApiError(409, "A portfolio with that name already exists", "conflict");
    return ok({ id: row.id }, { status: 201 });
  });
});
