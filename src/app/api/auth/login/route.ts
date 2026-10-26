import { z } from "zod";
import { audit } from "@/lib/audit";
import { findUserByEmail } from "@/lib/auth/accounts";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { clientIp, createSession } from "@/lib/auth/session";
import { api, ApiError, enforceRateLimit, ok, parseBody } from "@/lib/http";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const POST = api(async (req) => {
  const ip = (await clientIp()) ?? "unknown";
  await enforceRateLimit(`login:ip:${ip}`, 20, 900);
  const { email, password } = await parseBody(req, schema);
  await enforceRateLimit(`login:email:${email}`, 8, 900);

  const user = await findUserByEmail(email);
  // Always run a hash comparison so response time does not reveal whether the account exists.
  const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !valid || user.status !== "active") {
    await audit(user?.id ?? null, "auth.login_failed", { type: "user", id: user?.id }, { email, reason: !user ? "unknown_email" : !valid ? "bad_password" : "disabled" }, ip);
    throw new ApiError(401, "Invalid email or password.", "invalid_credentials");
  }
  await createSession(user.id);
  await audit(user.id, "auth.login", { type: "user", id: user.id }, {}, ip);
  return ok({ ok: true, emailVerified: Boolean(user.email_verified_at) });
});
