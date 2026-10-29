-- Billing is crypto-only (Solana Pay, prepaid). Card billing through Stripe is removed.
-- Stripe subscriptions can no longer be kept in sync (no webhooks), so any still open are closed here. Their rows
-- and payment_events stay as history; the 'stripe' source remains valid for those rows only.
UPDATE subscriptions SET status = 'canceled', canceled_at = coalesce(canceled_at, now()), updated_at = now()
 WHERE source = 'stripe' AND status <> 'canceled';
ALTER TABLE subscriptions ALTER COLUMN source DROP DEFAULT;

ALTER TABLE subscription_plans DROP COLUMN stripe_price_monthly;
ALTER TABLE subscription_plans DROP COLUMN stripe_price_annual;

DELETE FROM api_provider_status WHERE provider = 'stripe';
