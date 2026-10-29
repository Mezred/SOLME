-- Unique buyers per coin, counted from a sample of its real pool trades (Coin Check, or the Early Coins sampler).
-- Market data providers only report buy transactions; this is the one source of distinct wallets.
CREATE TABLE token_buyer_stats (
  chain        text NOT NULL,
  address      text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  buyers       integer NOT NULL,
  trades       integer NOT NULL,
  span_minutes integer,
  PRIMARY KEY (chain, address)
);

-- The last full Coin Check of each watched coin, re-run in the background for the watchlist risk alert.
-- changed_at: when the risk level last changed (an alert fires once per change to high or critical).
CREATE TABLE token_risk_checks (
  token_id    uuid PRIMARY KEY REFERENCES token_assets(id) ON DELETE CASCADE,
  risk        text NOT NULL CHECK (risk IN ('low', 'moderate', 'high', 'critical')),
  prev_risk   text CHECK (prev_risk IN ('low', 'moderate', 'high', 'critical')),
  findings    jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON token_buyer_stats, token_risk_checks TO nexalpha_app;
