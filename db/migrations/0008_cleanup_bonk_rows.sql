-- Before LetsBonk creates were resolved on-chain, PumpPortal's "bonk" messages were stored as-is. Those rows
-- carry the curve's quote mint (e.g. USDC) instead of the new token and a creator that did not create it.
-- Correctly resolved rows always have the pool account in bonding_curve; the broken ones do not.
DELETE FROM launchpad_tokens WHERE pool = 'bonk' AND source = 'stream' AND bonding_curve IS NULL;

-- Dev profiles left with no recorded launch came only from those rows.
DELETE FROM dev_profiles d WHERE NOT EXISTS (SELECT 1 FROM launchpad_tokens l WHERE l.creator = d.creator);
