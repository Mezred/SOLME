-- Dev score v2: post-migration outcome per launch, recency, sample size and funder-linked wallets.

-- Market cap when a migration was first priced, and again ~1h later: did the coin hold or get dumped?
ALTER TABLE launchpad_tokens ADD COLUMN mcap_at_migration_usd numeric;
ALTER TABLE launchpad_tokens ADD COLUMN held_mcap_usd numeric;

-- The wallet that first funded the creator; creators sharing a (non-exchange) funder are scored as one dev.
ALTER TABLE dev_profiles ADD COLUMN funder text;
ALTER TABLE dev_profiles ADD COLUMN funder_checked_at timestamptz;
ALTER TABLE dev_profiles ADD COLUMN linked_wallets integer NOT NULL DEFAULT 1;
-- launches / migrated now count the whole linked group; own_* are this wallet's alone.
ALTER TABLE dev_profiles ADD COLUMN own_launches integer;
ALTER TABLE dev_profiles ADD COLUMN own_migrated integer;
ALTER TABLE dev_profiles ADD COLUMN held integer;
ALTER TABLE dev_profiles ADD COLUMN confidence text CHECK (confidence IN ('low', 'medium', 'high'));
ALTER TABLE dev_profiles ADD COLUMN score_version integer NOT NULL DEFAULT 1;
CREATE INDEX dev_profiles_funder_idx ON dev_profiles (funder) WHERE funder IS NOT NULL;
