import { z } from "zod";
import { createAccount, findUserByEmail, sendVerification } from "@/lib/auth/accounts";
import { passwordProblems } from "@/lib/auth/password";
import { clientIp, createSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { api, ApiError, badRequest, enforceRateLimit, ok, parseBody } from "@/lib/http";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  acceptTerms: z.literal(true, { error: "You must accept the Terms and Risk Disclaimer" }),
});

export const POST = api(async (req) => {
  const ip = (await clientIp()) ?? "unknown";
  // Strict in production; relaxed in development/test so automated suites can create accounts.
  await enforceRateLimit(`signup:ip:${ip}`, env.isProd ? 5 : 200, 600);
  const body = await parseBody(req, schema);
  const problem = passwordProblems(body.password, body.email);
  if (problem) throw badRequest(problem);
  if (await findUserByEmail(body.email)) throw new ApiError(409, "An account with this email already exists. Try logging in.", "conflict");
  const user = await createAccount(body.email, body.password, ip);
  const verification = await sendVerification(user.id, body.email);
  await createSession(user.id);
  return ok({ ok: true, verificationSent: true, devVerifyUrl: verification.devUrl });
});
