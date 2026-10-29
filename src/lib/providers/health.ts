import { query } from "@/lib/db";
import { integrations } from "@/lib/env";
import { setHealthSink } from "./http";

interface Agg {
  ok: number;
  err: number;
  lastOk?: Date;
  lastErr?: Date;
  lastError?: string;
  latency?: number;
}

const g = globalThis as unknown as { __nxHealth?: Map<string, Agg>; __nxHealthTimer?: NodeJS.Timeout };
const aggs = (g.__nxHealth ??= new Map());

setHealthSink((provider, ok, latencyMs, error) => {
  const a = aggs.get(provider) ?? { ok: 0, err: 0 };
  if (ok) {
    a.ok++;
    a.lastOk = new Date();
    a.latency = latencyMs;
  } else {
    a.err++;
    a.lastErr = new Date();
    a.lastError = error?.slice(0, 500);
  }
  aggs.set(provider, a);
});

/** Persists aggregated provider health. Status: down if the latest call failed and no success in 10 min. */
export async function flushProviderHealth() {
  const entries = [...aggs.entries()];
  aggs.clear();
  for (const [provider, a] of entries) {
    const recentOk = a.lastOk && Date.now() - a.lastOk.getTime() < 10 * 60_000;
    const status = a.err === 0 ? "healthy" : recentOk ? "degraded" : "down";
    await query(
      `INSERT INTO api_provider_status (provider, status, last_success_at, last_error_at, last_error, latency_ms, success_count, error_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (provider) DO UPDATE SET
         status = EXCLUDED.status,
         last_success_at = COALESCE(EXCLUDED.last_success_at, api_provider_status.last_success_at),
         last_error_at = COALESCE(EXCLUDED.last_error_at, api_provider_status.last_error_at),
         last_error = COALESCE(EXCLUDED.last_error, api_provider_status.last_error),
         latency_ms = COALESCE(EXCLUDED.latency_ms, api_provider_status.latency_ms),
         success_count = api_provider_status.success_count + EXCLUDED.success_count,
         error_count = api_provider_status.error_count + EXCLUDED.error_count,
         updated_at = now()`,
      [provider, status, a.lastOk ?? null, a.lastErr ?? null, a.lastError ?? null, a.latency ?? null, a.ok, a.err],
    );
  }
  // Keyed integrations that are not configured are reported explicitly rather than omitted.
  const keyed: [string, boolean][] = [
    ["helius", integrations.helius],
    ["anthropic", integrations.ai],
    ["resend", integrations.email],
    ["telegram", integrations.telegram],
  ];
  for (const [provider, configured] of keyed) {
    if (configured) continue;
    await query(
      `INSERT INTO api_provider_status (provider, status) VALUES ($1, 'unconfigured')
       ON CONFLICT (provider) DO UPDATE SET status = 'unconfigured', updated_at = now()`,
      [provider],
    );
  }
}

export async function listProviderStatus() {
  return query<{
    provider: string;
    status: string;
    last_success_at: Date | null;
    last_error_at: Date | null;
    last_error: string | null;
    latency_ms: number | null;
    success_count: number;
    error_count: number;
    updated_at: Date;
  }>("SELECT * FROM api_provider_status ORDER BY provider");
}
