import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { api, enforceRateLimit, ok, requireAdmin } from "@/lib/http";
import { enqueue } from "@/lib/jobs/queue";

/** Queues an immediate ingestion cycle (picked up by the worker). */
export const POST = api(async () => {
  const admin = await requireAdmin();
  await enforceRateLimit(`admin-ingest:${admin.id}`, 5, 300);
  const id = await enqueue("ingest.cycle", { manual: true }, { dedupKey: `ingest.cycle:manual:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 1 });
  await audit(admin.id, "admin.ingestion_triggered", { type: "job", id: String(id ?? "") }, {}, await clientIp());
  return ok({ ok: true, queued: id !== null });
});
