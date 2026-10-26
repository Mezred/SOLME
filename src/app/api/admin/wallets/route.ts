import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { CHAIN_IDS, normalizeAddress, type ChainId } from "@/lib/chains";
import { isUuid, query, queryOne } from "@/lib/db";
import { api, badRequest, ok, parseBody, requireAdmin } from "@/lib/http";

const schema = z.object({
  chain: z.enum(CHAIN_IDS as [ChainId, ...ChainId[]]),
  address: z.string().trim().min(20).max(64),
  label: z.string().trim().min(1).max(60),
  classification: z.enum(["whale", "fund", "smart_money", "exchange"]),
  classification_source: z.string().trim().min(5).max(200),
  source_url: z.string().trim().url().max(500).nullable(),
});

/** Adds or updates a public, documented wallet profile. A cited source is mandatory. */
export const POST = api(async (req) => {
  const admin = await requireAdmin();
  const b = await parseBody(req, schema);
  const address = normalizeAddress(b.chain, b.address);
  if (!address) throw badRequest("Invalid address for this chain");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO wallet_profiles (chain, address, label, classification, classification_source, source_url, is_public, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (chain, address) DO UPDATE SET label = EXCLUDED.label, classification = EXCLUDED.classification,
       classification_source = EXCLUDED.classification_source, source_url = EXCLUDED.source_url, is_public = true
     RETURNING id`,
    [b.chain, address, b.label, b.classification, b.classification_source, b.source_url, admin.id],
  );
  await audit(admin.id, "admin.wallet_documented", { type: "wallet", id: row!.id }, b, await clientIp());
  return ok({ id: row!.id }, { status: 201 });
});

export const DELETE = api(async (req) => {
  const admin = await requireAdmin();
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) throw badRequest("Invalid id");
  await query("UPDATE wallet_profiles SET is_public = false, classification = 'unknown', classification_source = NULL, source_url = NULL WHERE id = $1", [id]);
  await audit(admin.id, "admin.wallet_undocumented", { type: "wallet", id }, {}, await clientIp());
  return ok({ ok: true });
});
