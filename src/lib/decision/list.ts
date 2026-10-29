import { decide, type Decision } from "./verdict";

/** Market facts every list row has (latest snapshot + latest contract check). */
export interface ListFacts {
  ai_score: number | null;
  signal_type: string | null;
  price_usd: number | null;
  price_change_h1: number | null;
  price_change_h6?: number | null;
  price_change_h24: number | null;
  liquidity_usd: number | null;
  buys_h1: number | null;
  sells_h1: number | null;
  security_risk: string | null;
}

/** The pre-check used wherever many tokens are listed (no holder data, so at best "candidate"). */
export function listDecision(r: ListFacts): Decision {
  return decide({
    priceUsd: r.price_usd,
    change: { h1: r.price_change_h1, h6: r.price_change_h6 ?? null, h24: r.price_change_h24 },
    liquidityUsd: r.liquidity_usd,
    buysH1: r.buys_h1,
    sellsH1: r.sells_h1,
    security: r.security_risk ? { riskLevel: r.security_risk, failedChecks: [] } : null,
  });
}
