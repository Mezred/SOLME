import { z } from "zod";
import { runChat } from "@/lib/ai/chat";
import { getEntitlements } from "@/lib/billing/entitlements";
import { api, enforceRateLimit, ok, parseBody, requireUser } from "@/lib/http";

export const maxDuration = 300;

const schema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  kind: z.enum(["chat", "analysis"]).default("chat"),
});

export const POST = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`ai:${user.id}`, 6, 60);
  const body = await parseBody(req, schema);
  const ent = await getEntitlements(user.id);
  const result = await runChat({ userId: user.id, ent, conversationId: body.conversationId, message: body.message, kind: body.kind });
  return ok(result);
});
