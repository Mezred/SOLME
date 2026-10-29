-- Screener templates as alerts: a rule fires when a coin newly matches one of the user's saved templates.
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'security_warning', 'wallet_activity', 'dev_deploy', 'curve_progress', 'smart_wallet_buy', 'screener_match'));
