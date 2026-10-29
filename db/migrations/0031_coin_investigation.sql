-- Coin Check investigation: sell simulation, connected holders, liquidity depth and trading patterns per coin,
-- cached for a few minutes (see src/lib/tokens/investigate.ts).
CREATE TABLE token_investigations (
  chain       text NOT NULL,
  address     text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL,
  PRIMARY KEY (chain, address)
);

-- A wallet's first funder and first activity never change: looked up once, reused by every check.
CREATE TABLE wallet_origins (
  address    text PRIMARY KEY,
  funder     text,
  first_at   timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_origins_funder_idx ON wallet_origins (funder) WHERE funder IS NOT NULL;
