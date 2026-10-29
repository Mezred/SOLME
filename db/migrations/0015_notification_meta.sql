-- Structured alert content (coin, contract, key facts) so chat channels can lay messages out properly.
ALTER TABLE notifications ADD COLUMN meta jsonb;
