import { cookies, headers } from "next/headers";
import { cache } from "react";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomToken } from "./tokens";

export const SESSION_COOKIE = "nx_session";

export type Role = "user" | "support" | "admin";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  sessionId: string;
  displayName: string | null;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Creates a session row and sets the httpOnly cookie. Call from Route Handlers / Server Actions only. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  await query(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [userId, hashToken(token), await clientIp(), h.get("user-agent")?.slice(0, 300) ?? null, env.sessionDays],
  );
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: env.sessionDays * 86400,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)",
    [userId, exceptSessionId ?? null],
  );
}

/** Resolves the signed-in user for this request (memoized per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await queryOne<{
    session_id: string;
    last_seen_at: Date;
    id: string;
    email: string;
    role: Role;
    email_verified_at: Date | null;
    display_name: string | null;
  }>(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, r.name AS role, u.email_verified_at, p.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(() => {});
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    emailVerified: Boolean(row.email_verified_at),
    sessionId: row.session_id,
    displayName: row.display_name,
  };
});
