import { query, queryOne } from "@/lib/db";

export interface ScoringSettings {
  version: string;
  weights: Record<string, number>;
  security_penalty: { critical: number; high: number; medium: number; unknown: number };
  thresholds: {
    min_liquidity_usd: number;
    min_volume_h24_usd: number;
    /** Bullish patterns below this AI score are not eligible. */
    min_score: number;
    min_confidence: number;
    stale_after_minutes: number;
  };
}

export interface IngestionSettings {
  enabled: boolean;
  interval_seconds: number;
  chains: string[];
  max_tokens_per_cycle: number;
  security_ttl_hours: number;
  snapshot_retention_days: number;
}

interface SettingsMap {
  scoring: ScoringSettings;
  ingestion: IngestionSettings;
}

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 15_000;

export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingsMap[K];
  const row = await queryOne<{ value: SettingsMap[K] }>("SELECT value FROM app_settings WHERE key = $1", [key]);
  if (!row) throw new Error(`Missing app setting: ${key}`);
  cache.set(key, { value: row.value, at: Date.now() });
  return row.value;
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K], userId: string | null) {
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
  cache.delete(key);
}
