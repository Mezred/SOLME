-- Trader features: launchpad/smart-wallet alerts, holder analysis cache, launch-time snapshots for an
-- honest public track record, and smart-wallet watcher state.

-- New alert rule types.
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'signal_score', 'security_warning', 'wallet_activity',
   'dev_deploy', 'curve_progress', 'smart_wallet_buy'));

-- Captured when a launch is first seen, before the launch itself is counted, so track-record stats
-- judge each pick by what was known at the time (no look-ahead).
ALTER TABLE launchpad_tokens ADD COLUMN dev_score_at_launch integer;
ALTER TABLE launchpad_tokens ADD COLUMN dev_launches_at_launch integer;
ALTER TABLE launchpad_tokens ADD COLUMN initial_market_cap_sol numeric;

-- Last signature seen per watched smart wallet (the watcher only reads newer transactions).
CREATE TABLE wallet_watch_state (
  wallet_id       uuid PRIMARY KEY REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  last_signature  text,
  polled_at       timestamptz NOT NULL DEFAULT now()
);

-- Holder / bundle analysis per token, recomputed at most every few minutes on view.
CREATE TABLE token_holder_analysis (
  chain        text NOT NULL,
  address      text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  data         jsonb NOT NULL,
  PRIMARY KEY (chain, address)
);
GRANT SELECT ON token_holder_analysis TO nexalpha_app;

-- Free tier: one more rule so launchpad alerts are usable in-app (real-time push stays on paid plans).
UPDATE subscription_plans
   SET features = jsonb_set(features, '{max_alert_rules}', '3'::jsonb)
 WHERE id = 'free' AND (features->>'max_alert_rules')::int = 2;
