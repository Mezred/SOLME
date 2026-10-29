-- Signals are removed from the product. Scores and patterns stay on token_assets.metadata.last_score
-- (the Early list and the pre-buy check read them); signal records, factors and outcomes go.

-- Signal alerts: "candidates only" rules (incl. the Early preset) become Early-coin alerts, which fire when a
-- coin newly passes every pre-check; other signal rules can never fire again and are removed.
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
UPDATE alert_rules
   SET rule_type = 'early_coin', params = jsonb_strip_nulls(jsonb_build_object('preset', params->'preset'))
 WHERE rule_type = 'signal_score' AND (params->>'candidates_only')::boolean;
DELETE FROM alert_rules WHERE rule_type = 'signal_score';
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'security_warning', 'wallet_activity', 'dev_deploy', 'curve_progress', 'smart_wallet_buy', 'early_coin'));

DROP TABLE signal_history;
DROP TABLE signal_factors;
DROP TABLE signals;

-- Plan entitlements: the feed limit and history window only applied to signals; the delay now applies
-- to the Early list and keeps its value under a neutral name.
UPDATE subscription_plans
   SET features = (features - 'signal_feed_limit' - 'signal_history_days' - 'signal_delay_minutes')
                  || jsonb_build_object('data_delay_minutes', COALESCE(features->'signal_delay_minutes', '0'::jsonb));

-- Scoring thresholds: drop the signal-only ones (dedup, re-score, TTL) and rename the eligibility bars.
UPDATE app_settings
   SET value = jsonb_set(value, '{thresholds}',
         ((value->'thresholds') - 'dedup_hours' - 'rescore_delta' - 'signal_ttl_hours' - 'signal_min_score' - 'signal_min_confidence')
         || jsonb_build_object('min_score', value->'thresholds'->'signal_min_score', 'min_confidence', value->'thresholds'->'signal_min_confidence'))
 WHERE key = 'scoring';
