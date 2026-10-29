import { audit } from "@/lib/audit";
import { query, queryOne, transaction } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env, integrations } from "@/lib/env";
import { hashPassword } from "./password";
import { issueAuthToken } from "./tokens";

/** Creates a user with profile, default watchlist and portfolio. */
export async function createAccount(email: string, password: string, ip: string | null) {
  const passwordHash = await hashPassword(password);
  const isBootstrapAdmin = Boolean(env.bootstrapAdminEmail && env.bootstrapAdminEmail === email.toLowerCase());
  const user = await transaction(async (tx) => {
    const [u] = await tx.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id",
      [email, passwordHash, isBootstrapAdmin ? 3 : 1],
    );
    await tx.query("INSERT INTO profiles (user_id) VALUES ($1)", [u.id]);
    await tx.query("INSERT INTO watchlists (user_id, name) VALUES ($1, 'Main')", [u.id]);
    await tx.query("INSERT INTO portfolios (user_id, name) VALUES ($1, 'Main')", [u.id]);
    return u;
  });
  await audit(user.id, "auth.signup", { type: "user", id: user.id }, { bootstrapAdmin: isBootstrapAdmin }, ip);
  return user;
}

export async function findUserByEmail(email: string) {
  return queryOne<{ id: string; email: string; password_hash: string | null; status: string; email_verified_at: Date | null }>(
    "SELECT id, email, password_hash, status, email_verified_at FROM users WHERE lower(email) = lower($1)",
    [email],
  );
}

/**
 * Sends the verification email. When no email provider is configured outside production, the link is
 * returned so developers can complete the flow locally; in production it is never returned.
 */
export async function sendVerification(userId: string, email: string): Promise<{ devUrl?: string }> {
  const token = await issueAuthToken(userId, "verify_email");
  const url = `${env.appUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(email, "Verify your SOLME email", `Confirm your email address to finish setting up SOLME:\n\n${url}\n\nThis link expires in 24 hours. If you did not create an account, ignore this message.`);
  return !integrations.email && !env.isProd ? { devUrl: url } : {};
}

export async function sendPasswordReset(userId: string, email: string): Promise<{ devUrl?: string }> {
  const token = await issueAuthToken(userId, "reset_password");
  const url = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail(email, "Reset your SOLME password", `A password reset was requested for your account.\n\n${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, you can ignore this email — your password will not change.`);
  return !integrations.email && !env.isProd ? { devUrl: url } : {};
}

export async function markVerified(userId: string) {
  await query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [userId]);
}
