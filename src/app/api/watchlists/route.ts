import { z } from "zod";
import { getEntitlements } from "@/lib/billing/entitlements";
import { withUser } from "@/lib/db";
import { api, ApiError, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";

export const GET = api(async () => {
  const user = await requireUser();
  const lists = await withUser(user.id, (tx) =>
    tx.query(
      `SELECT w.id, w.name, w.created_at, count(i.id)::int AS items FROM watchlists w LEFT JOIN watchlist_items i ON i.watchlist_id = w.id
        GROUP BY w.id ORDER BY w.created_at`,
    ),
  );
  return ok({ watchlists: lists });
});

const create = z.object({ name: z.string().trim().min(1).max(60) });

export const POST = api(async (req) => {
  const user = await requireUser();
  const { name } = await parseBody(req, create);
  const ent = await getEntitlements(user.id);
  return withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM watchlists");
    if (n >= ent.features.max_watchlists) throw upgradeRequired(`Your plan allows ${ent.features.max_watchlists} watchlist(s).`);
    const [row] = await tx.query<{ id: string }>(
      "INSERT INTO watchlists (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO NOTHING RETURNING id",
      [user.id, name],
    );
    if (!row) throw new ApiError(409, "A watchlist with that name already exists", "conflict");
    return ok({ id: row.id }, { status: 201 });
  });
});
