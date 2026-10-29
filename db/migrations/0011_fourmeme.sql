-- four.meme (BNB Smart Chain) launches on the Trenches board and in Smart Dev.
-- Launchpad rows gain a chain; existing rows are pump.fun / LetsBonk on Solana. EVM mints and creators are
-- stored lower-cased, so they can never collide with Solana's base58 keys.
-- The *_sol columns hold amounts in the chain's native unit (SOL on Solana, BNB on BSC).
ALTER TABLE launchpad_tokens ADD COLUMN chain text NOT NULL DEFAULT 'solana';
CREATE INDEX launchpad_tokens_chain_created_idx ON launchpad_tokens (chain, created_at DESC);
