-- 6h buys/sells (DexScreener reports them; the Screener filters on every timeframe it has).
ALTER TABLE market_snapshots ADD COLUMN buys_h6 integer;
ALTER TABLE market_snapshots ADD COLUMN sells_h6 integer;
