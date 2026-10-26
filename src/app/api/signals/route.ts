import { getEntitlements } from "@/lib/billing/entitlements";
import { listSignals, signalFilterSchema } from "@/lib/data/signals";
import { api, enforceRateLimit, ok, parseQuery, requireUser } from "@/lib/http";

/** GET /api/signals — paginated, filtered signal feed with plan restrictions applied server-side. */
export const GET = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`signals:${user.id}`, 120, 60);
  const filters = parseQuery(req, signalFilterSchema);
  const ent = await getEntitlements(user.id);
  const page = await listSignals(filters, ent);
  return ok(page);
});
