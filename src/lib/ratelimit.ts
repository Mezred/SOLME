import { queryOne } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Fixed-window rate limiter stored in Postgres so limits hold across server instances.
 * `key` should include the scope, e.g. `login:ip:1.2.3.4` or `ai:user:<uuid>`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowStart],
  );
  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(windowStart.getTime() + windowMs),
  };
}
