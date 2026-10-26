-- Row-level security as defense in depth.
--
-- User-scoped queries run inside withUser(): a transaction that does
--   SET LOCAL ROLE nexalpha_app; SELECT set_config('app.user_id', <uuid>, true);
-- nexalpha_app is not a superuser and does not own the tables, so these policies apply.
-- System jobs and admin endpoints run as the connection owner (after server-side authorization).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexalpha_app') THEN
    CREATE ROLE nexalpha_app NOLOGIN;
  END IF;
  EXECUTE format('GRANT nexalpha_app TO %I', current_user);
END
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO nexalpha_app;
GRANT EXECUTE ON FUNCTION app_current_user() TO nexalpha_app;

-- Shared, read-only market data.
GRANT SELECT ON token_assets, market_pairs, market_snapshots, token_security_checks,
  signals, signal_factors, signal_history, subscription_plans, wallet_transactions
  TO nexalpha_app;

-- User-owned data.
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles, watchlists, watchlist_items, portfolios,
  positions, trades, alert_rules, notifications, ai_conversations, ai_messages,
  user_tracked_wallets TO nexalpha_app;
GRANT SELECT ON alert_events, subscriptions TO nexalpha_app;
GRANT SELECT, INSERT, UPDATE ON wallet_profiles TO nexalpha_app;

-- Owner-only policies on every user table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'watchlists', 'watchlist_items', 'portfolios', 'positions',
    'trades', 'alert_rules', 'alert_events', 'notifications', 'ai_conversations', 'ai_messages',
    'user_tracked_wallets', 'subscriptions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO nexalpha_app USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user())',
      t || '_owner', t);
  END LOOP;
END
$$;

-- Child rows must also point at a parent the user owns.
CREATE POLICY watchlist_items_parent ON watchlist_items AS RESTRICTIVE FOR ALL TO nexalpha_app
  USING (EXISTS (SELECT 1 FROM watchlists w WHERE w.id = watchlist_id AND w.user_id = app_current_user()));
CREATE POLICY positions_parent ON positions AS RESTRICTIVE FOR ALL TO nexalpha_app
  USING (EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = app_current_user()));
CREATE POLICY trades_parent ON trades AS RESTRICTIVE FOR ALL TO nexalpha_app
  USING (EXISTS (SELECT 1 FROM positions p WHERE p.id = position_id AND p.user_id = app_current_user()));
CREATE POLICY ai_messages_parent ON ai_messages AS RESTRICTIVE FOR ALL TO nexalpha_app
  USING (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.user_id = app_current_user()));

-- Wallet profiles are shared rows keyed by (chain, address) and are created by server code.
-- Users can read public (documented) profiles and the ones they track.
ALTER TABLE wallet_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_profiles_read ON wallet_profiles FOR SELECT TO nexalpha_app
  USING (is_public OR EXISTS (
    SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = id AND t.user_id = app_current_user()));
REVOKE INSERT, UPDATE ON wallet_profiles FROM nexalpha_app;
