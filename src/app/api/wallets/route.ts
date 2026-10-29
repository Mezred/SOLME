import { z } from "zod";
import { assertChain, getEntitlements } from "@/lib/billing/entitlements";
import { CHAIN_IDS, normalizeAddress, type ChainId } from "@/lib/chains";
import { queryOne, withUser } from "@/lib/db";
import { api, badRequest, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";

export const GET = api(async () => {
  const user = await requireUser();
  const wallets = await withUser(user.id, (tx) =>
    tx.query(
      `SELECT w.id, w.chain, w.address, w.label, w.classification, w.classification_source, w.last_synced_at, t.custom_label, t.alerts_enabled
         FROM user_tracked_wallets t JOIN wallet_profiles w ON w.id = t.wallet_id ORDER BY t.created_at DESC`,
    ),
  );
  return ok({ wallets });
});

const add = z.object({
  chain: z.enum(CHAIN_IDS as [ChainId, ...ChainId[]]),
  address: z.string().trim().min(20).max(64),
  label: z.string().trim().max(60).optional(),
});

/** Track a public wallet. User labels are stored per user; global classifications are admin-only and sourced. */
export const POST = api(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, add);
  const ent = await getEntitlements(user.id);
  if (ent.features.max_tracked_wallets === 0) throw upgradeRequired("Wallet tracking requires Pro or Elite.");
  assertChain(ent, b.chain);
  const address = normalizeAddress(b.chain, b.address);
  if (!address) throw badRequest("That address is not valid for the selected chain.");

  // Shared profile row keyed by (chain, address); created by server code, never with a classification.
  const wallet = await queryOne<{ id: string }>(
    `INSERT INTO wallet_profiles (chain, address, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (chain, address) DO UPDATE SET chain = EXCLUDED.chain RETURNING id`,
    [b.chain, address, user.id],
  );
  await withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM user_tracked_wallets");
    if (n >= ent.features.max_tracked_wallets) throw upgradeRequired(`Your plan allows ${ent.features.max_tracked_wallets} tracked wallets.`);
    await tx.query(
      `INSERT INTO user_tracked_wallets (user_id, wallet_id, custom_label) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, wallet_id) DO UPDATE SET custom_label = COALESCE(EXCLUDED.custom_label, user_tracked_wallets.custom_label)`,
      [user.id, wallet!.id, b.label || null],
    );
  });
  await enqueue("wallets.sync", {}, { dedupKey: `wallets.sync:add:${wallet!.id}:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 2 });
  if (b.chain === "solana") await enqueue("wallets.score", {}, { dedupKey: `wallets.score:add:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 2 });
  return ok({ id: wallet!.id }, { status: 201 });
});
