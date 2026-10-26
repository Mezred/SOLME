import { z } from "zod";
import { assertChain, getEntitlements } from "@/lib/billing/entitlements";
import { isChainId } from "@/lib/chains";
import { isUuid, queryOne, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";

const add = z.object({ tokenId: z.string().uuid(), watchlistId: z.string().uuid().optional() });

export const POST = api(async (req) => {
  const user = await requireUser();
  const { tokenId, watchlistId } = await parseBody(req, add);
  const token = await queryOne<{ chain: string }>("SELECT chain FROM token_assets WHERE id = $1", [tokenId]);
  if (!token || !isChainId(token.chain)) throw notFound("Token not found");
  const ent = await getEntitlements(user.id);
  assertChain(ent, token.chain);
  return withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM watchlist_items");
    if (n >= ent.features.max_watchlist_items) throw upgradeRequired(`Your plan allows ${ent.features.max_watchlist_items} watched tokens.`);
    const [list] = watchlistId
      ? await tx.query<{ id: string }>("SELECT id FROM watchlists WHERE id = $1", [watchlistId])
      : await tx.query<{ id: string }>("SELECT id FROM watchlists ORDER BY created_at LIMIT 1");
    if (!list) throw notFound("Watchlist not found");
    await tx.query(
      "INSERT INTO watchlist_items (watchlist_id, user_id, token_id) VALUES ($1, $2, $3) ON CONFLICT (watchlist_id, token_id) DO NOTHING",
      [list.id, user.id, tokenId],
    );
    return ok({ ok: true, watchlistId: list.id }, { status: 201 });
  });
});

export const DELETE = api(async (req) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const tokenId = sp.get("tokenId");
  const itemId = sp.get("itemId");
  if (itemId && isUuid(itemId)) {
    await withUser(user.id, (tx) => tx.query("DELETE FROM watchlist_items WHERE id = $1", [itemId]));
  } else if (tokenId && isUuid(tokenId)) {
    await withUser(user.id, (tx) => tx.query("DELETE FROM watchlist_items WHERE token_id = $1", [tokenId]));
  } else throw badRequest("tokenId or itemId required");
  return ok({ ok: true });
});

const patch = z.object({ itemId: z.string().uuid(), isFavorite: z.boolean().optional(), notes: z.string().max(500).nullable().optional() });

export const PATCH = api(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, patch);
  const rows = await withUser(user.id, (tx) =>
    tx.query(
      "UPDATE watchlist_items SET is_favorite = COALESCE($2, is_favorite), notes = CASE WHEN $3::boolean THEN $4 ELSE notes END WHERE id = $1 RETURNING id",
      [b.itemId, b.isFavorite ?? null, b.notes !== undefined, b.notes ?? null],
    ),
  );
  if (!rows.length) throw notFound();
  return ok({ ok: true });
});
