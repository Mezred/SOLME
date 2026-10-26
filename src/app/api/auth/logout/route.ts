import { destroySession } from "@/lib/auth/session";
import { api, ok } from "@/lib/http";

export const POST = api(async () => {
  await destroySession();
  return ok({ ok: true });
});
