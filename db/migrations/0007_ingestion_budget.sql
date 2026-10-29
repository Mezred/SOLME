-- Five chains share one discovery budget per cycle; 120 left busy chains capped. Cycles measured 3–74s,
-- well inside the 120s interval. Only raises the untouched default, so an administrator's value is kept.
UPDATE app_settings
   SET value = jsonb_set(value, '{max_tokens_per_cycle}', '250'::jsonb)
 WHERE key = 'ingestion' AND (value->>'max_tokens_per_cycle')::int = 120;
