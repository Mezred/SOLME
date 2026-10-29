-- Group buys: several smart wallets buying the same coin within minutes.
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (rule_type IN
  ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
   'security_warning', 'wallet_activity', 'dev_deploy', 'curve_progress', 'smart_wallet_buy', 'screener_match', 'smart_group_buy'));

-- "If you copied": each detected buy priced when we saw it (when an alert would reach you), closed at the price when
-- the wallet sold, or marked to market while still held. Recomputed by the smartmoney.copystats job.
CREATE TABLE wallet_copy_stats (
  wallet_id     uuid PRIMARY KEY REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  trades        integer NOT NULL,
  closed        integer NOT NULL,
  wins          integer NOT NULL,
  avg_return    numeric,
  median_return numeric,
  computed_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON wallet_copy_stats TO nexalpha_app;
