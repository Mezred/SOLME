import { sendVerification } from "@/lib/auth/accounts";
import { api, enforceRateLimit, ok, requireUser } from "@/lib/http";

export const POST = api(async () => {
  const user = await requireUser();
  if (user.emailVerified) return ok({ ok: true, alreadyVerified: true });
  await enforceRateLimit(`verify-resend:${user.id}`, 3, 3600);
  const r = await sendVerification(user.id, user.email);
  return ok({ ok: true, devVerifyUrl: r.devUrl });
});
