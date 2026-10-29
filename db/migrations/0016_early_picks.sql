-- Measured track record of the Early list: every coin that qualified, its entry, and what happened next.
-- Outcomes come only from NEXALPHA's own later snapshots (never estimated).
CREATE TABLE early_picks (
  id                 bigserial PRIMARY KEY,
  token_id           uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  chain              text NOT NULL,
  symbol             text NOT NULL,
  entered_at         timestamptz NOT NULL DEFAULT now(),
  ai_score           integer,
  price_at_entry     numeric NOT NULL CHECK (price_at_entry > 0),
  mcap_at_entry      numeric,
  liquidity_at_entry numeric,
  return_1h          numeric,
  return_6h          numeric,
  return_24h         numeric,
  max_return_24h     numeric,
  min_return_24h     numeric,
  is_final           boolean NOT NULL DEFAULT false,
  is_demo            boolean NOT NULL DEFAULT false
);
CREATE INDEX early_picks_entered_idx ON early_picks (entered_at DESC);
CREATE INDEX early_picks_token_idx ON early_picks (token_id, entered_at DESC);

-- Public, read-only outcome data (like market snapshots).
GRANT SELECT ON early_picks TO nexalpha_app;
