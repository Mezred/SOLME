import { z } from "zod";
import { withUser } from "@/lib/db";
import { api, ok, parseBody, requireUser } from "@/lib/http";

export const GET = api(async () => {
  const user = await requireUser();
  const items = await withUser(user.id, (tx) =>
    tx.query("SELECT id, title, body, link, created_at, read_at FROM notifications WHERE channel = 'in_app' ORDER BY created_at DESC LIMIT 100"),
  );
  return ok({ notifications: items });
});

/** Marks notifications read: specific ids, or all when ids is omitted. */
export const POST = api(async (req) => {
  const user = await requireUser();
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(200).optional() }));
  await withUser(user.id, (tx) =>
    ids
      ? tx.query("UPDATE notifications SET read_at = now(), status = 'read' WHERE channel = 'in_app' AND id = ANY($1) AND read_at IS NULL", [ids])
      : tx.query("UPDATE notifications SET read_at = now(), status = 'read' WHERE channel = 'in_app' AND read_at IS NULL"),
  );
  return ok({ ok: true });
});
