-- NEXALPHA core schema.
-- Tokens are identified by (chain, normalized address). Every market/security/signal row
-- carries is_demo so demo data can never be confused with provider data.

-- ───────────────────────────── identity ─────────────────────────────
CREATE TABLE roles (
  id          smallint PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);

INSERT INTO roles (id, name, description) VALUES
  (1, 'user',    'Standard customer account'),
  (2, 'support', 'Can read support tickets and user summaries'),
  (3, 'admin',   'Full administrative access');

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL CHECK (position('@' in email) > 1),
  password_hash     text,
  email_verified_at timestamptz,
  role_id           smallint NOT NULL DEFAULT 1 REFERENCES roles(id),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE profiles (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name     text,
  timezone         text NOT NULL DEFAULT 'UTC',
  telegram_chat_id text,
  notify_in_app    boolean NOT NULL DEFAULT true,
  notify_email     boolean NOT NULL DEFAULT true,
  notify_telegram  boolean NOT NULL DEFAULT false,
  preferences      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- ───────────────────────────── billing ─────────────────────────────
CREATE TABLE subscription_plans (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  price_monthly_cents  integer NOT NULL DEFAULT 0 CHECK (price_monthly_cents >= 0),
  price_annual_cents   integer NOT NULL DEFAULT 0 CHECK (price_annual_cents >= 0),
  currency             text NOT NULL DEFAULT 'usd',
  stripe_price_monthly text,
  stripe_price_annual  text,
  features             jsonb NOT NULL,
  sort_order           integer NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                  text NOT NULL REFERENCES subscription_plans(id),
  source                   text NOT NULL DEFAULT 'stripe' CHECK (source IN ('stripe', 'admin_grant')),
  provider_customer_id     text,
  provider_subscription_id text UNIQUE,
  billing_interval         text CHECK (billing_interval IN ('month', 'year')),
  status                   text NOT NULL CHECK (status IN
                             ('trialing', 'active', 'past_due', 'canceled', 'incomplete',
                              'incomplete_expired', 'unpaid', 'paused')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  canceled_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, status);
CREATE INDEX subscriptions_customer_idx ON subscriptions (provider_customer_id);

CREATE TABLE payment_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  event_id     text NOT NULL,
  event_type   text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  amount_cents integer,
  currency     text,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);
CREATE INDEX payment_events_user_idx ON payment_events (user_id, received_at DESC);

-- ───────────────────────────── market data ─────────────────────────────
CREATE TABLE token_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain             text NOT NULL,
  address           text NOT NULL,
  symbol            text NOT NULL,
  name              text NOT NULL,
  logo_url          text,
  pair_created_at   timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  is_spam           boolean NOT NULL DEFAULT false,
  spam_reason       text,
  is_demo           boolean NOT NULL DEFAULT false,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (chain, address)
);
CREATE INDEX token_assets_chain_updated_idx ON token_assets (chain, updated_at DESC);
CREATE INDEX token_assets_pair_created_idx ON token_assets (pair_created_at DESC);
CREATE INDEX token_assets_symbol_idx ON token_assets (lower(symbol));

CREATE TABLE market_pairs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id        uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  chain           text NOT NULL,
  pair_address    text NOT NULL,
  dex_id          text,
  quote_symbol    text,
  quote_address   text,
  url             text,
  pair_created_at timestamptz,
  liquidity_usd   numeric,
  is_primary      boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain, pair_address)
);
CREATE INDEX market_pairs_token_idx ON market_pairs (token_id);

CREATE TABLE market_snapshots (
  id               bigserial PRIMARY KEY,
  token_id         uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  pair_id          uuid REFERENCES market_pairs(id) ON DELETE SET NULL,
  source           text NOT NULL,
  captured_at      timestamptz NOT NULL DEFAULT now(),
  price_usd        numeric,
  price_change_m5  numeric,
  price_change_h1  numeric,
  price_change_h6  numeric,
  price_change_h24 numeric,
  price_change_d7  numeric,
  volume_m5        numeric,
  volume_h1        numeric,
  volume_h6        numeric,
  volume_h24       numeric,
  liquidity_usd    numeric,
  market_cap       numeric,
  fdv              numeric,
  buys_m5          integer,
  sells_m5         integer,
  buys_h1          integer,
  sells_h1         integer,
  buys_h24         integer,
  sells_h24        integer,
  holder_count     integer,
  is_demo          boolean NOT NULL DEFAULT false
);
CREATE INDEX market_snapshots_token_time_idx ON market_snapshots (token_id, captured_at DESC);
CREATE INDEX market_snapshots_time_idx ON market_snapshots (captured_at DESC);

CREATE TABLE token_security_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id           uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  checked_at         timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL CHECK (status IN ('complete', 'partial', 'unavailable', 'error')),
  risk_level         text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical', 'unknown')),
  checks             jsonb NOT NULL DEFAULT '[]'::jsonb,
  unavailable_checks text[] NOT NULL DEFAULT '{}',
  limitations        text NOT NULL DEFAULT '',
  holder_count       integer,
  top10_holder_pct   numeric,
  raw                jsonb,
  is_demo            boolean NOT NULL DEFAULT false
);
CREATE INDEX token_security_token_time_idx ON token_security_checks (token_id, checked_at DESC);

-- ───────────────────────────── signals ─────────────────────────────
CREATE TABLE signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id         uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  chain            text NOT NULL,
  snapshot_id      bigint REFERENCES market_snapshots(id) ON DELETE SET NULL,
  signal_type      text NOT NULL CHECK (signal_type IN
                     ('momentum', 'accumulation', 'breakout_watch', 'distribution', 'high_risk')),
  strength         text NOT NULL CHECK (strength IN ('strong', 'moderate', 'weak', 'avoid')),
  ai_score         smallint NOT NULL CHECK (ai_score BETWEEN 0 AND 100),
  quality_score    smallint CHECK (quality_score BETWEEN 0 AND 100),
  momentum_score   smallint CHECK (momentum_score BETWEEN 0 AND 100),
  risk_score       smallint CHECK (risk_score BETWEEN 0 AND 100),
  confidence_score smallint NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  price_at_signal  numeric,
  entry_low        numeric,
  entry_high       numeric,
  invalidation     numeric,
  stop_loss        numeric,
  take_profits     jsonb,
  rationale        text NOT NULL DEFAULT '',
  risk_flags       text[] NOT NULL DEFAULT '{}',
  missing_data     text[] NOT NULL DEFAULT '{}',
  scoring_version  text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'invalidated')),
  dedup_key        text NOT NULL UNIQUE,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);
CREATE INDEX signals_created_idx ON signals (created_at DESC);
CREATE INDEX signals_chain_created_idx ON signals (chain, created_at DESC);
CREATE INDEX signals_score_idx ON signals (ai_score DESC);
CREATE INDEX signals_token_idx ON signals (token_id, created_at DESC);

CREATE TABLE signal_factors (
  signal_id    uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  factor_key   text NOT NULL,
  category     text NOT NULL CHECK (category IN ('quality', 'momentum', 'risk', 'context')),
  score        smallint CHECK (score BETWEEN 0 AND 100),
  weight       numeric NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason       text NOT NULL DEFAULT '',
  missing      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (signal_id, factor_key)
);

-- Outcomes are measured from later snapshots — never estimated.
CREATE TABLE signal_history (
  signal_id        uuid PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  price_1h         numeric,
  price_6h         numeric,
  price_24h        numeric,
  return_1h        numeric,
  return_6h        numeric,
  return_24h       numeric,
  max_price        numeric,
  min_price        numeric,
  hit_take_profit  boolean,
  hit_invalidation boolean,
  is_final         boolean NOT NULL DEFAULT false,
  evaluated_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── wallets ─────────────────────────────
CREATE TABLE wallet_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain                 text NOT NULL,
  address               text NOT NULL,
  label                 text,
  -- Only non-'unknown' when classification_source documents where the label came from.
  classification        text NOT NULL DEFAULT 'unknown' CHECK (classification IN
                          ('unknown', 'whale', 'fund', 'smart_money', 'insider', 'exchange', 'user_labeled')),
  classification_source text,
  source_url            text,
  is_public             boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  last_synced_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain, address),
  CHECK (classification IN ('unknown', 'user_labeled') OR classification_source IS NOT NULL)
);

CREATE TABLE user_tracked_wallets (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id      uuid NOT NULL REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  custom_label   text,
  alerts_enabled boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, wallet_id)
);

CREATE TABLE wallet_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     uuid NOT NULL REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  chain         text NOT NULL,
  tx_hash       text NOT NULL,
  block_time    timestamptz NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('buy', 'sell', 'transfer_in', 'transfer_out', 'other')),
  token_address text,
  token_symbol  text,
  amount        numeric,
  amount_usd    numeric,
  counterparty  text,
  provider      text NOT NULL,
  raw           jsonb,
  UNIQUE (chain, tx_hash, wallet_id, token_address, direction)
);
CREATE INDEX wallet_tx_wallet_time_idx ON wallet_transactions (wallet_id, block_time DESC);
CREATE INDEX wallet_tx_token_idx ON wallet_transactions (chain, token_address, block_time DESC);

-- ───────────────────────────── user data ─────────────────────────────
CREATE TABLE watchlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE watchlist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id     uuid NOT NULL REFERENCES token_assets(id) ON DELETE CASCADE,
  is_favorite  boolean NOT NULL DEFAULT false,
  notes        text,
  added_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, token_id)
);
CREATE INDEX watchlist_items_user_idx ON watchlist_items (user_id);

CREATE TABLE portfolios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE positions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id      uuid REFERENCES token_assets(id) ON DELETE SET NULL,
  chain         text NOT NULL,
  token_address text NOT NULL,
  token_symbol  text NOT NULL,
  -- 'manual' entries are user-reported; nothing here is custody or on-chain verification.
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'blockchain_verified')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  stop_loss     numeric CHECK (stop_loss IS NULL OR stop_loss >= 0),
  take_profits  jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes         text,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX positions_user_idx ON positions (user_id, status);

CREATE TABLE trades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity    numeric NOT NULL CHECK (quantity > 0),
  price       numeric NOT NULL CHECK (price >= 0),
  fee         numeric NOT NULL DEFAULT 0 CHECK (fee >= 0),
  executed_at timestamptz NOT NULL DEFAULT now(),
  note        text
);
CREATE INDEX trades_position_idx ON trades (position_id, executed_at);

CREATE TABLE alert_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  rule_type         text NOT NULL CHECK (rule_type IN
                      ('price_above', 'price_below', 'price_change', 'volume_spike', 'liquidity_drop',
                       'signal_score', 'security_warning', 'wallet_activity')),
  chain             text,
  token_id          uuid REFERENCES token_assets(id) ON DELETE CASCADE,
  wallet_id         uuid REFERENCES wallet_profiles(id) ON DELETE CASCADE,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels          text[] NOT NULL DEFAULT '{in_app}',
  cooldown_minutes  integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
  is_active         boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_rules_active_idx ON alert_rules (is_active, rule_type);
CREATE INDEX alert_rules_user_idx ON alert_rules (user_id);

CREATE TABLE alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedup_key    text NOT NULL,
  payload      jsonb NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, dedup_key)
);
CREATE INDEX alert_events_user_idx ON alert_events (user_id, triggered_at DESC);

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_event_id uuid REFERENCES alert_events(id) ON DELETE CASCADE,
  channel        text NOT NULL CHECK (channel IN ('in_app', 'email', 'telegram')),
  title          text NOT NULL,
  body           text NOT NULL,
  link           text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'read')),
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  read_at        timestamptz,
  UNIQUE (alert_event_id, channel)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_pending_idx ON notifications (status, channel) WHERE status = 'pending';

CREATE TABLE ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  kind            text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'analysis')),
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_trace      jsonb NOT NULL DEFAULT '[]'::jsonb,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  cost_usd        numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, created_at);
CREATE INDEX ai_messages_user_time_idx ON ai_messages (user_id, created_at DESC);

-- ───────────────────────────── operations ─────────────────────────────
CREATE TABLE api_provider_status (
  provider        text PRIMARY KEY,
  status          text NOT NULL CHECK (status IN ('healthy', 'degraded', 'down', 'unconfigured')),
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  latency_ms      integer,
  success_count   bigint NOT NULL DEFAULT 0,
  error_count     bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error   text,
  locked_at    timestamptz,
  locked_by    text,
  dedup_key    text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX jobs_due_idx ON jobs (status, run_at);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE email_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email            text NOT NULL,
  subject             text NOT NULL,
  body_text           text NOT NULL,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'logged')),
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

CREATE TABLE support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text NOT NULL,
  subject    text NOT NULL,
  message    text NOT NULL,
  priority   text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'priority')),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_logs (
  id         bigserial PRIMARY KEY,
  level      text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source     text NOT NULL,
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_logs_level_time_idx ON app_logs (level, created_at DESC);
