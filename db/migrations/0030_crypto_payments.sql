-- Crypto subscriptions: prepaid periods paid in USDC or SOL on Solana (Solana Pay), straight to the operator's wallet.
-- Each checkout is a quote with a unique amount and a unique reference key; the worker confirms it on-chain.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_source_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_source_check CHECK (source IN ('stripe', 'admin_grant', 'crypto'));
-- Renewal reminders already sent for the current period (so each is sent once).
ALTER TABLE subscriptions ADD COLUMN reminded_at timestamptz;

CREATE TABLE crypto_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id          text NOT NULL REFERENCES subscription_plans(id),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  currency         text NOT NULL CHECK (currency IN ('USDC', 'SOL')),
  -- Exact amount due in base units (USDC: 6 decimals, SOL: lamports); unique among open quotes.
  amount_base      bigint NOT NULL CHECK (amount_base > 0),
  amount_usd_cents integer NOT NULL,
  recipient        text NOT NULL,
  reference        text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired')),
  signature        text UNIQUE,
  payer            text,
  subscription_id  uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  confirmed_at     timestamptz,
  checked_at       timestamptz
);
CREATE INDEX crypto_payments_user_idx ON crypto_payments (user_id, created_at DESC);
CREATE INDEX crypto_payments_open_idx ON crypto_payments (status, expires_at) WHERE status = 'pending';
