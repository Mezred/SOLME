-- Token names/symbols padded with block, box-drawing or invisible characters ("█████WIF") are shown without them
-- (same rule as readableLabel in src/lib/format.ts). The original label is kept in metadata the first time.
UPDATE token_assets
   SET metadata = metadata || jsonb_build_object('original_symbol', COALESCE(metadata->>'original_symbol', symbol), 'original_name', COALESCE(metadata->>'original_name', name)),
       symbol = trim(regexp_replace(symbol, '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]', '', 'g')),
       name = trim(regexp_replace(name, '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]', '', 'g'))
 WHERE symbol ~ '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]' OR name ~ '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]';

UPDATE launchpad_tokens
   SET symbol = trim(regexp_replace(symbol, '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]', '', 'g')),
       name = trim(regexp_replace(name, '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]', '', 'g'))
 WHERE symbol ~ '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]' OR name ~ '[\u2500-\u25FF\u200B-\u200F\u2060\uFEFF]';

-- Nothing readable left: show the short contract address instead.
UPDATE token_assets SET symbol = left(address, 4) || '…' || right(address, 4) WHERE symbol !~ '[[:alnum:]]';
UPDATE token_assets SET name = left(address, 4) || '…' || right(address, 4) WHERE name !~ '[[:alnum:]]';
UPDATE launchpad_tokens SET symbol = left(mint, 4) || '…' || right(mint, 4) WHERE symbol IS NOT NULL AND symbol !~ '[[:alnum:]]';
UPDATE launchpad_tokens SET name = left(mint, 4) || '…' || right(mint, 4) WHERE name IS NOT NULL AND name !~ '[[:alnum:]]';
