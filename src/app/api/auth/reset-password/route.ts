import { z } from "zod";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { clientIp, createSession, revokeAllSessions } from "@/lib/auth/session";
import { consumeAuthToken, hashToken } from "@/lib/auth/tokens";
import { query, queryOne } from "@/lib/db";
import { api, badRequest, enforceRateLimit, ok, parseBody } from "@/lib/http";

const schema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });

export const POST = api(async (req) => {
  const ip = (await clientIp()) ?? "unknown";
  await enforceRateLimit(`reset:ip:${ip}`, 10, 900);
  const { token, password } = await parseBody(req, schema);
  const pending = await queryOne<{ email: string }>(
    `SELECT u.email FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = 'reset_password' AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(token)],
  );
  if (!pending) throw badRequest("This reset link is invalid or has expired. Request a new one.");
  const problem = passwordProblems(password, pending.email);
  if (problem) throw badRequest(problem);
  const userId = await consumeAuthToken(token, "reset_password");
  if (!userId) throw badRequest("This reset link is invalid or has expired. Request a new one.");
  await query("UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [userId, await hashPassword(password)]);
  await revokeAllSessions(userId);
  await audit(userId, "auth.password_reset", { type: "user", id: userId }, {}, ip);
  await createSession(userId);
  return ok({ ok: true });
});
