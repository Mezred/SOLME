-- Launchpad (pump.fun) board and token-developer tracking.
-- Sources: PumpPortal's free create/migrate stream, Helius bonding-curve reads, DexScreener after migration,
-- and Helius history backfills of a creator's earlier launches.

CREATE TABLE launchpad_tokens (
  mint                 text PRIMARY KEY,
  pool                 text NOT NULL,
  creator              text NOT NULL,
  name                 text,
  symbol               text,
  uri                  text,
  bonding_curve        text,
  created_at           timestamptz NOT NULL,
  -- 'stream' rows were seen live; 'backfill' rows were found later in a creator's history.
  source               text NOT NULL CHECK (source IN ('stream', 'backfill')),
  initial_buy_sol      numeric,
  progress             numeric,             -- bonding-curve completion, 0..1
  market_cap_sol       numeric,
  peak_market_cap_sol  numeric,             -- highest value we observed, not an all-time high
  complete             boolean NOT NULL DEFAULT false,
  migrated_at          timestamptz,
  market_cap_usd       numeric,
  peak_market_cap_usd  numeric,
  liquidity_usd        numeric,
  checked_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX launchpad_tokens_creator_idx ON launchpad_tokens (creator);
CREATE INDEX launchpad_tokens_created_idx ON launchpad_tokens (created_at DESC);

CREATE TABLE dev_profiles (
  creator              text PRIMARY KEY,
  launches             integer NOT NULL DEFAULT 0,
  migrated             integer NOT NULL DEFAULT 0,
  best_market_cap_usd  numeric,
  score                integer CHECK (score BETWEEN 0 AND 100),
  last_launch_at       timestamptz,
  backfilled_at        timestamptz,
  backfill_error       text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dev_profiles_score_idx ON dev_profiles (score DESC NULLS LAST);

GRANT SELECT ON launchpad_tokens, dev_profiles TO nexalpha_app;
