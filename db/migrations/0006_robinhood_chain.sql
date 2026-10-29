-- Robinhood Chain: enable it on the paid plans and in ingestion. Appends only when absent, so plans or
-- settings an administrator already edited keep their other values.
UPDATE subscription_plans
   SET features = jsonb_set(features, '{chains}', (features->'chains') || '["robinhood"]'::jsonb)
 WHERE id IN ('pro', 'elite') AND NOT (features->'chains' ? 'robinhood');

UPDATE app_settings
   SET value = jsonb_set(value, '{chains}', (value->'chains') || '["robinhood"]'::jsonb)
 WHERE key = 'ingestion' AND NOT (value->'chains' ? 'robinhood');
