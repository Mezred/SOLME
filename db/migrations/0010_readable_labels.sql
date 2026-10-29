-- Token symbols/names with no letters or digits (e.g. "███") are unreadable in the UI. New data is cleaned at
-- ingestion (readableLabel in src/lib/format.ts); this fixes rows stored before that. It only matches labels made
-- of whitespace, ASCII punctuation and box/block/geometric characters (U+2500–U+25FF), so names in other
-- scripts (Chinese, Korean, accented Latin…) and emoji are never touched. The original labels are kept.

UPDATE token_assets
   SET metadata = metadata || jsonb_build_object('original_symbol', symbol, 'original_name', name),
       symbol = CASE WHEN address LIKE '0x%' THEN left(address, 6) ELSE left(address, 4) END || '…' || right(address, 4),
       name = CASE WHEN name ~ '^[\s─-◿!-/:-@\[-`{-~]*$'
                   THEN CASE WHEN address LIKE '0x%' THEN left(address, 6) ELSE left(address, 4) END || '…' || right(address, 4)
                   ELSE name END
 WHERE symbol ~ '^[\s─-◿!-/:-@\[-`{-~]*$';

UPDATE launchpad_tokens
   SET symbol = left(mint, 4) || '…' || right(mint, 4),
       name = CASE WHEN name ~ '^[\s─-◿!-/:-@\[-`{-~]*$' THEN left(mint, 4) || '…' || right(mint, 4) ELSE name END
 WHERE symbol ~ '^[\s─-◿!-/:-@\[-`{-~]*$';
