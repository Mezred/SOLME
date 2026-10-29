-- An Early pick whose coin had no market 24h later while the engine was running (rugged / delisted).
-- Counted as −100% in the track record; picks with a data gap on our side stay unmeasured instead.
ALTER TABLE early_picks ADD COLUMN no_market boolean NOT NULL DEFAULT false;
