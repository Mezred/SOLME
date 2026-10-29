-- The Early list and the track record are removed from the product. Proven-dev launches, the scam check on
-- launches (launch_checks) and every other alert type stay.

-- Early-coin alerts can never fire again.
DELETE FROM alert_rules WHERE rule_type = 'early_coin';
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'security_warning', 'wallet_activity', 'dev_deploy', 'curve_progress', 'smart_wallet_buy'));

-- Early picks only fed the track record.
DROP TABLE early_picks;

-- The data delay only applied to the Early list.
UPDATE subscription_plans SET features = features - 'data_delay_minutes';
UPDATE token_assets SET metadata = metadata - 'early_since' WHERE metadata ? 'early_since';
