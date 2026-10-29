-- On-chain wallet scoring (Solana, from Helius transaction history).
-- Scores are a documented heuristic over a wallet's own swaps. They never set
-- wallet_profiles.classification, which stays admin-curated and source-cited.

-- Latest score per wallet. score is NULL when there are too few decided positions to judge.
CREATE TABLE wallet_scores (
  wallet_id            uuid PRIMARY KEY REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  scored_at            timestamptz NOT NULL DEFAULT now(),
  version              text NOT NULL,
  score                integer CHECK (score BETWEEN 0 AND 100),
  trades               integer NOT NULL,
  decided_positions    integer NOT NULL,
  open_positions       integer NOT NULL,
  wins                 integer NOT NULL,
  losses               integer NOT NULL,
  pnl_sol              numeric NOT NULL,
  early_entries        integer NOT NULL,
  early_hits           integer NOT NULL,
  median_hold_minutes  numeric,
  bot_like             boolean NOT NULL DEFAULT false,
  -- History window actually covered (may be shorter than requested for very active wallets).
  covered_from         timestamptz,
  metrics              jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX wallet_scores_rank_idx ON wallet_scores (bot_like, score DESC NULLS LAST);

-- Wallets found buying a token early, before it pumped. One row per (wallet, token).
CREATE TABLE smart_money_candidates (
  wallet_id            uuid NOT NULL REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  token_id             uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  entry_delay_seconds  integer NOT NULL,
  entry_sol            numeric NOT NULL,
  discovered_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_id, token_id)
);
CREATE INDEX smart_money_candidates_token_idx ON smart_money_candidates (token_id);

-- Tokens already scanned for early buyers, so each pump is scanned once.
CREATE TABLE smart_money_scans (
  token_id    uuid PRIMARY KEY REFERENCES token_assets(id) ON DELETE CASCADE,
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  launch_at   timestamptz,
  buyers      integer NOT NULL
);

-- Derived from public on-chain data; readable like wallet_transactions.
GRANT SELECT ON wallet_scores, smart_money_candidates TO nexalpha_app;
