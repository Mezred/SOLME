-- NEXALPHA covers Solana only. Removes every row of other chains (Ethereum, BSC, Base, Robinhood) and makes each
-- chain column accept Solana only. Child rows go with their parents (ON DELETE CASCADE).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'chain'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE chain IS NOT NULL AND chain <> %L', t.table_name, 'solana');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (chain IS NULL OR chain = %L)', t.table_name, t.table_name || '_solana_only', 'solana');
  END LOOP;
END $$;

-- BSC (four.meme) creators are stored as 0x addresses.
DELETE FROM dev_profiles WHERE creator LIKE '0x%';

-- Plans and ingestion list Solana only.
UPDATE subscription_plans SET features = jsonb_set(features, '{chains}', '["solana"]'::jsonb);
UPDATE app_settings SET value = jsonb_set(value, '{chains}', '["solana"]'::jsonb) WHERE key = 'ingestion';
