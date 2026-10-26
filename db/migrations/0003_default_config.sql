-- Default, admin-editable configuration: plans/entitlements, scoring weights, ingestion settings.
-- Prices are placeholders; set real prices and Stripe price IDs in Admin → Pricing.

INSERT INTO subscription_plans (id, name, description, price_monthly_cents, price_annual_cents, features, sort_order) VALUES
('free', 'Free', 'Core research tools to get started.', 0, 0, '{
  "chains": ["solana", "base"],
  "signal_feed_limit": 25,
  "signal_delay_minutes": 15,
  "signal_history_days": 1,
  "advanced_filters": false,
  "max_watchlists": 1,
  "max_watchlist_items": 15,
  "max_portfolios": 1,
  "portfolio_analytics": "basic",
  "csv_export": false,
  "max_alert_rules": 2,
  "alert_channels": ["in_app"],
  "ai_daily_requests": 5,
  "ai_deep_analysis": false,
  "max_tracked_wallets": 0,
  "smart_money": false,
  "whale_alerts": false,
  "market_intelligence": "basic",
  "priority_support": false
}', 1),
('pro', 'Pro', 'Full multi-chain scanning, deep AI analysis and custom alerts.', 2900, 29000, '{
  "chains": ["solana", "ethereum", "bsc", "base"],
  "signal_feed_limit": 200,
  "signal_delay_minutes": 0,
  "signal_history_days": 30,
  "advanced_filters": true,
  "max_watchlists": 10,
  "max_watchlist_items": 100,
  "max_portfolios": 5,
  "portfolio_analytics": "advanced",
  "csv_export": true,
  "max_alert_rules": 25,
  "alert_channels": ["in_app", "email", "telegram"],
  "ai_daily_requests": 50,
  "ai_deep_analysis": true,
  "max_tracked_wallets": 5,
  "smart_money": false,
  "whale_alerts": false,
  "market_intelligence": "standard",
  "priority_support": false
}', 2),
('elite', 'Elite', 'Wallet intelligence, whale alerts and the highest AI limits.', 7900, 79000, '{
  "chains": ["solana", "ethereum", "bsc", "base"],
  "signal_feed_limit": 1000,
  "signal_delay_minutes": 0,
  "signal_history_days": 365,
  "advanced_filters": true,
  "max_watchlists": 50,
  "max_watchlist_items": 500,
  "max_portfolios": 20,
  "portfolio_analytics": "advanced",
  "csv_export": true,
  "max_alert_rules": 100,
  "alert_channels": ["in_app", "email", "telegram"],
  "ai_daily_requests": 200,
  "ai_deep_analysis": true,
  "max_tracked_wallets": 100,
  "smart_money": true,
  "whale_alerts": true,
  "market_intelligence": "advanced",
  "priority_support": true
}', 3);

INSERT INTO app_settings (key, value) VALUES
('scoring', '{
  "version": "v1",
  "weights": {
    "price_momentum": 0.13,
    "volume_acceleration": 0.12,
    "buy_sell_imbalance": 0.12,
    "liquidity_quality": 0.14,
    "liquidity_to_mcap": 0.06,
    "holder_distribution": 0.10,
    "token_age": 0.06,
    "trading_activity": 0.08,
    "smart_money": 0.08,
    "market_regime": 0.05,
    "volatility": 0.06
  },
  "security_penalty": { "critical": 100, "high": 25, "medium": 10, "unknown": 5 },
  "thresholds": {
    "min_liquidity_usd": 25000,
    "min_volume_h24_usd": 10000,
    "signal_min_score": 60,
    "signal_min_confidence": 45,
    "dedup_hours": 6,
    "rescore_delta": 10,
    "stale_after_minutes": 15,
    "signal_ttl_hours": 24
  }
}'),
('ingestion', '{
  "enabled": true,
  "interval_seconds": 120,
  "chains": ["solana", "ethereum", "bsc", "base"],
  "max_tokens_per_cycle": 120,
  "security_ttl_hours": 6,
  "snapshot_retention_days": 14
}');
