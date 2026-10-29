-- Wallet score v2: out-of-sample check and insider detection (src/lib/wallets/scoring.ts, smart-money.ts).
-- held_up / faded / too_few: whether the last 10 days of trades (not used for the score) confirm it.
ALTER TABLE wallet_scores ADD COLUMN oos_verdict text CHECK (oos_verdict IN ('held_up', 'faded', 'too_few'));
-- Why a wallet looks like an insider (launches coins, funded or was funded by a creator…); such wallets are capped low.
ALTER TABLE wallet_scores ADD COLUMN insider_reason text;
ALTER TABLE wallet_scores ADD COLUMN funder text;
