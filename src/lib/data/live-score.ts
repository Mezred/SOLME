import type { TokenRow } from "./tokens";
import type { SecurityRow } from "./tokens";
import { scoreToken, type ScoringResult } from "@/lib/scoring/engine";
import { getSetting } from "@/lib/settings";

/**
 * Recomputes the deterministic score from the latest stored snapshot and security check — used on token
 * pages and as AI grounding. No candles (volatility and trade levels need the ingestion path).
 */
export async function liveScore(t: TokenRow, sec: SecurityRow | null): Promise<ScoringResult | null> {
  if (!t.captured_at) return null;
  const settings = await getSetting("scoring");
  const tx = (b: number | null, s: number | null) => (b !== null && s !== null ? { buys: b, sells: s } : null);
  return scoreToken(
    {
      now: new Date(),
      capturedAt: new Date(t.captured_at),
      market: {
        priceUsd: t.price_usd,
        priceChange: { m5: t.price_change_m5, h1: t.price_change_h1, h6: t.price_change_h6, h24: t.price_change_h24, d7: t.price_change_d7 },
        volume: { m5: null, h1: t.volume_h1, h6: null, h24: t.volume_h24 },
        liquidityUsd: t.liquidity_usd,
        marketCap: t.market_cap,
        fdv: t.fdv,
        txns: { h1: tx(t.buys_h1, t.sells_h1), h24: tx(t.buys_h24, t.sells_h24) },
        pairCreatedAt: t.pair_created_at ? new Date(t.pair_created_at) : null,
        promoted: Boolean(t.metadata?.promoted),
      },
      security: sec ? { status: sec.status as never, riskLevel: sec.risk_level as never, checks: sec.checks, checkedAt: new Date(sec.checked_at) } : null,
      holders: sec ? { count: sec.holder_count, top10Pct: sec.top10_holder_pct } : null,
      smartMoney: null,
      regime: null,
      candles: null,
    },
    settings,
  );
}
