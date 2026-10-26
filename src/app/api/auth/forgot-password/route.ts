import { z } from "zod";
import { audit } from "@/lib/audit";
import { findUserByEmail, sendPasswordReset } from "@/lib/auth/accounts";
import { clientIp } from "@/lib/auth/session";
import { api, enforceRateLimit, ok, parseBody } from "@/lib/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Always returns the same response so the endpoint cannot be used to discover accounts. */
export const POST = api(async (req) => {
  const ip = (await clientIp()) ?? "unknown";
  await enforceRateLimit(`forgot:ip:${ip}`, 5, 900);
  const { email } = await parseBody(req, schema);
  await enforceRateLimit(`forgot:email:${email}`, 3, 3600);
  const user = await findUserByEmail(email);
  let devResetUrl: string | undefined;
  if (user && user.status === "active") {
    devResetUrl = (await sendPasswordReset(user.id, user.email)).devUrl;
    await audit(user.id, "auth.password_reset_requested", { type: "user", id: user.id }, {}, ip);
  }
  return ok({ ok: true, message: "If an account exists for that email, a reset link has been sent.", devResetUrl });
});
