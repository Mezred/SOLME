import { isUuid, withUser } from "@/lib/db";
import { api, badRequest, ok, requireUser } from "@/lib/http";

export const GET = api(async (req) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!isUuid(id)) throw badRequest("Invalid id");
    const messages = await withUser(user.id, (tx) =>
      tx.query("SELECT id, role, content, sources, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at", [id]),
    );
    return ok({ messages });
  }
  const conversations = await withUser(user.id, (tx) => tx.query("SELECT id, title, updated_at FROM ai_conversations ORDER BY updated_at DESC LIMIT 50"));
  return ok({ conversations });
});

export const DELETE = api(async (req) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) throw badRequest("Invalid id");
  await withUser(user.id, (tx) => tx.query("DELETE FROM ai_conversations WHERE id = $1", [id]));
  return ok({ ok: true });
});
