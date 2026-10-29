-- Early Coins alerts (a coin enters Building Momentum / Early Activity) and watchlist risk alerts (a watched coin's
-- contract risk rises or its liquidity drops sharply).
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'security_warning', 'wallet_activity', 'dev_deploy', 'curve_progress', 'smart_wallet_buy', 'screener_match', 'smart_group_buy',
   'early_coin', 'watchlist_risk'));
