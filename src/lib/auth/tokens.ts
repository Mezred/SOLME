import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, type Queryable } from "@/lib/db";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes; the raw value exists only in the email/cookie. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type Purpose = "verify_email" | "reset_password";

const TTL_MINUTES: Record<Purpose, number> = { verify_email: 60 * 24, reset_password: 30 };

export async function issueAuthToken(userId: string, purpose: Purpose): Promise<string> {
  const token = randomToken();
  // Invalidate earlier outstanding tokens of the same purpose.
  await query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [
    userId,
    purpose,
  ]);
  await query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, hashToken(token), TTL_MINUTES[purpose]],
  );
  return token;
}

/** Atomically consumes a valid token. Returns the user id, or null if invalid/expired/used. */
export async function consumeAuthToken(token: string, purpose: Purpose, tx?: Queryable): Promise<string | null> {
  const sql = `UPDATE auth_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`;
  const params = [hashToken(token), purpose];
  const row = tx ? (await tx.query<{ user_id: string }>(sql, params))[0] : await queryOne<{ user_id: string }>(sql, params);
  return row?.user_id ?? null;
}
