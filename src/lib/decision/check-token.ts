import type { ChainId } from "@/lib/chains";
import { queryOne } from "@/lib/db";
import { lookupAddress } from "@/lib/ingestion/lookup";
import { evidenceInput, failedCheckLabels, loadDecisionEvidence, warnCheckLabels } from "./evidence";
import { decide, type Decision } from "./verdict";

interface Facts {
  id: string;
  symbol: string;
  price_usd: number | null;
  price_change_m5: number | null;
  price_change_h1: number | null;
  price_change_h6: number | null;
  price_change_h24: number | null;
  liquidity_usd: number | null;
  market_cap: number | null;
  age_hours: number | null;
  dex_id: string | null;
  buys_h1: number | null;
  sells_h1: number | null;
  risk_level: string | null;
  sec_status: string | null;
  checks: unknown;
}

const FACTS = `
  SELECT t.id, t.symbol, snap.price_usd, snap.price_change_m5, snap.price_change_h1, snap.price_change_h6, snap.price_change_h24,
         snap.liquidity_usd, COALESCE(snap.market_cap, snap.fdv) AS market_cap,
         (EXTRACT(EPOCH FROM (now() - t.pair_created_at)) / 3600)::float AS age_hours, mp.dex_id,
         snap.buys_h1, snap.sells_h1, sec.risk_level, sec.status AS sec_status, sec.checks
    FROM token_assets t
    LEFT JOIN LATERAL (SELECT * FROM market_snapshots m WHERE m.token_id = t.id ORDER BY m.captured_at DESC LIMIT 1) snap ON true
    LEFT JOIN market_pairs mp ON mp.id = snap.pair_id
    LEFT JOIN LATERAL (SELECT risk_level, status, checks FROM token_security_checks c WHERE c.token_id = t.id ORDER BY c.checked_at DESC LIMIT 1) sec ON true
   WHERE t.chain = $1 AND t.address = $2 AND NOT t.is_spam`;

/** Bonding-curve "pairs" as DexScreener lists them (pump.fun, LetsBonk, Meteora DBC). */
export const CURVE_DEXES = ["pumpfun", "launchlab", "meteoradbc"];

/**
 * The full risk check for one token (alert filters, the watchlist re-check): fetches the token (market data + contract check) when it
 * is not tracked yet, then adds holders & launch, the creator's record and sells, and smart-wallet buys.
 * Null when the token is not trading on a DEX.
 * `explicit`: fetch the coin even below the discovery size filter (fresh launches the user or a job asked about).
 * `budgetUserId`: a user asked for this check, so a fresh holder report counts against their budget.
 */
export async function checkToken(chain: ChainId, address: string, opts: { explicit?: boolean; budgetUserId?: string } = {}): Promise<{ tokenId: string; symbol: string; decision: Decision } | null> {
  let f = await queryOne<Facts>(FACTS, [chain, address]);
  if (!f) {
    await lookupAddress(address, [chain], { explicit: opts.explicit });
    f = await queryOne<Facts>(FACTS, [chain, address]);
    if (!f) return null;
  }
  const ev = await loadDecisionEvidence({ chain, address, is_demo: false }, opts.budgetUserId);
  const decision = decide({
    priceUsd: f.price_usd,
    change: { m5: f.price_change_m5, h1: f.price_change_h1, h6: f.price_change_h6, h24: f.price_change_h24 },
    liquidityUsd: f.liquidity_usd,
    marketCapUsd: f.market_cap,
    ageHours: f.age_hours,
    onBondingCurve: CURVE_DEXES.includes(f.dex_id ?? ""),
    buysH1: f.buys_h1,
    sellsH1: f.sells_h1,
    security: f.risk_level && f.sec_status !== "unavailable" && f.sec_status !== "error" ? { riskLevel: f.risk_level, failedChecks: failedCheckLabels(f.checks), warnings: warnCheckLabels(f.checks) } : null,
    ...evidenceInput(ev),
  });
  return { tokenId: f.id, symbol: f.symbol, decision };
}

/** "Passes the scam check": no safety item failed and the contract was actually verified. */
export function passesScamCheck(d: Decision): boolean {
  const contract = d.gate.find((g) => g.key === "contract");
  return d.verdict !== "avoid" && contract !== undefined && contract.status !== "unknown";
}
