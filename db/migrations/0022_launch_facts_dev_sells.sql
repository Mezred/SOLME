-- Launch facts captured once, shortly after launch (from the holder report's launch analysis).
ALTER TABLE launch_checks ADD COLUMN bundle_pct numeric;
ALTER TABLE launch_checks ADD COLUMN sniper_wallets integer;
ALTER TABLE launch_checks ADD COLUMN sniper_pct numeric;
ALTER TABLE launch_checks ADD COLUMN launch_facts_at timestamptz;

-- Sales by a launch's creator of their own coin, seen live (src/lib/wallets/live.ts).
CREATE TABLE dev_sells (
  signature   text NOT NULL,
  mint        text NOT NULL,
  creator     text NOT NULL,
  sol         numeric,
  supply_pct  numeric,
  sold_at     timestamptz NOT NULL,
  PRIMARY KEY (signature, mint)
);
CREATE INDEX dev_sells_mint_idx ON dev_sells (mint, sold_at DESC);
GRANT SELECT ON dev_sells TO nexalpha_app;
