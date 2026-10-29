import type { ChainId } from "@/lib/chains";
import { checkToken } from "@/lib/decision/check-token";
import type { RiskLevel } from "@/lib/decision/verdict";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";

const log = logger("watch-checks");

/** Coins re-checked per run, oldest check first. A full check reads holders and the investigation (Helius credits). */
const PER_RUN = 4;
/** A watched coin is re-checked once its last full check is this old. */
export const RECHECK_MINUTES = 30;
const ORDER: RiskLevel[] = ["low", "moderate", "high", "critical"];

/**
 * Pure: did the risk rise into high or critical? The first check of a coin has nothing to compare with, so it never
 * alerts: the alert is about a coin turning risky, not about a coin that was risky from the start.
 */
export function riskRoseToAlert(prev: RiskLevel | null, next: RiskLevel): boolean {
  if (prev === null || (next !== "high" && next !== "critical")) return false;
  return ORDER.indexOf(next) > ORDER.indexOf(prev);
}

/**
 * Re-runs the full risk check (sell simulation, holders, insiders, trading) on coins that are on the watchlist of
 * someone with an active watchlist risk alert, and records the overall risk. The alert engine reads the result
 * (see `watchlist_risk` in ./engine). Budgeted by the investigation's own platform-wide limit.
 */
export async function recheckWatchedCoins(): Promise<{ checked: number }> {
  if (env.demoMode) return { checked: 0 };
  const due = await query<{ id: string; chain: ChainId; address: string }>(
    `SELECT t.id, t.chain, t.address FROM token_assets t
       LEFT JOIN token_risk_checks rc ON rc.token_id = t.id
      WHERE t.chain = 'solana' AND NOT t.is_demo AND NOT t.is_spam
        AND EXISTS (SELECT 1 FROM watchlist_items wi JOIN alert_rules r ON r.user_id = wi.user_id
                     WHERE wi.token_id = t.id AND r.rule_type = 'watchlist_risk' AND r.is_active)
        AND (rc.computed_at IS NULL OR rc.computed_at < now() - make_interval(mins => $1))
      ORDER BY rc.computed_at NULLS FIRST
      LIMIT $2`,
    [RECHECK_MINUTES, PER_RUN],
  );
  let checked = 0;
  for (const t of due) {
    try {
      const res = await checkToken(t.chain, t.address);
      if (!res) continue;
      await recordRisk(t.id, res.decision.risk, res.decision.findings.map((f) => ({ label: f.label, detail: f.detail, status: f.status })));
      checked++;
    } catch (err) {
      log.warn("Watchlist re-check failed", { mint: t.address, error: errorMessage(err) });
    }
  }
  return { checked };
}

export async function recordRisk(tokenId: string, risk: RiskLevel, findings: unknown[]) {
  const prev = await queryOne<{ risk: RiskLevel }>("SELECT risk FROM token_risk_checks WHERE token_id = $1", [tokenId]);
  await query(
    `INSERT INTO token_risk_checks (token_id, risk, prev_risk, findings, computed_at, changed_at) VALUES ($1, $2, NULL, $3, now(), now())
     ON CONFLICT (token_id) DO UPDATE SET
       prev_risk = CASE WHEN token_risk_checks.risk <> EXCLUDED.risk THEN token_risk_checks.risk ELSE token_risk_checks.prev_risk END,
       changed_at = CASE WHEN token_risk_checks.risk <> EXCLUDED.risk THEN now() ELSE token_risk_checks.changed_at END,
       risk = EXCLUDED.risk, findings = EXCLUDED.findings, computed_at = now()`,
    [tokenId, risk, JSON.stringify(findings)],
  );
  return prev?.risk ?? null;
}
