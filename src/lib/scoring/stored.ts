/**
 * The latest score lives on token_assets.metadata.last_score (written by the ingestion pipeline). These SQL
 * fragments read it the same way everywhere; they expect the token table aliased as `t`.
 */
export const BULLISH_PATTERNS = ["momentum", "accumulation", "breakout_watch"];

/** The latest score is an eligible bullish pattern. */
export const BULLISH_ELIGIBLE_SQL = `(t.metadata->'last_score'->>'eligible')::boolean AND t.metadata->'last_score'->>'type' IN ('momentum', 'accumulation', 'breakout_watch')`;

/**
 * `ai_score` and `signal_type` columns for the pre-buy verdict. The pattern only counts when it was eligible
 * and scored in the last 6 hours; otherwise the verdict sees "no qualifying pattern".
 */
export const STORED_SCORE_COLUMNS = `(t.metadata->'last_score'->>'ai')::int AS ai_score,
  CASE WHEN (t.metadata->'last_score'->>'eligible')::boolean AND (t.metadata->'last_score'->>'at')::timestamptz > now() - interval '6 hours'
       THEN t.metadata->'last_score'->>'type' END AS signal_type`;
