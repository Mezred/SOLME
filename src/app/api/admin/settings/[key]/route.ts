import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { CHAIN_IDS } from "@/lib/chains";
import { api, badRequest, ok, parseBody, requireAdmin } from "@/lib/http";
import { FACTOR_DOCS } from "@/lib/scoring/engine";
import { getSetting, setSetting } from "@/lib/settings";

type Ctx = { params: Promise<{ key: string }> };

const weight = z.number().min(0).max(1);
const scoring = z.object({
  version: z.string().trim().regex(/^[a-z0-9._-]{1,20}$/i),
  weights: z.object(Object.fromEntries(Object.keys(FACTOR_DOCS).map((k) => [k, weight]))).refine((w) => Object.values(w).some((v) => (v as number) > 0), "At least one weight must be positive"),
  security_penalty: z.object({ critical: z.number().min(0).max(100), high: z.number().min(0).max(100), medium: z.number().min(0).max(100), unknown: z.number().min(0).max(100) }),
  thresholds: z.object({
    min_liquidity_usd: z.number().min(0),
    min_volume_h24_usd: z.number().min(0),
    signal_min_score: z.number().min(0).max(100),
    signal_min_confidence: z.number().min(0).max(100),
    dedup_hours: z.number().min(0.25).max(168),
    rescore_delta: z.number().min(1).max(100),
    stale_after_minutes: z.number().min(1).max(1440),
    signal_ttl_hours: z.number().min(1).max(720),
  }),
});

const ingestion = z.object({
  enabled: z.boolean(),
  interval_seconds: z.number().int().min(30).max(3600),
  chains: z.array(z.enum(CHAIN_IDS as [string, ...string[]])).min(1),
  max_tokens_per_cycle: z.number().int().min(10).max(600),
  security_ttl_hours: z.number().min(1).max(168),
  snapshot_retention_days: z.number().int().min(1).max(365),
});

export const PUT = api<Ctx>(async (req, ctx) => {
  const admin = await requireAdmin();
  const { key } = await ctx.params;
  if (key !== "scoring" && key !== "ingestion") throw badRequest("Unknown setting");
  const before = await getSetting(key);
  const ip = await clientIp();
  if (key === "scoring") {
    const value = await parseBody(req, scoring);
    await setSetting("scoring", value as never, admin.id);
    await audit(admin.id, "admin.scoring_updated", { type: "setting", id: key }, { before, after: value }, ip);
  } else {
    const value = await parseBody(req, ingestion);
    await setSetting("ingestion", value as never, admin.id);
    await audit(admin.id, "admin.ingestion_updated", { type: "setting", id: key }, { before, after: value }, ip);
  }
  return ok({ ok: true });
});
