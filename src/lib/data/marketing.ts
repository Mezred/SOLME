import { anonymousEntitlements } from "@/lib/billing/entitlements";
import { featureRows, listPlans } from "@/lib/billing/plans";
import { CHAIN_IDS } from "@/lib/chains";
import { listSignals } from "./signals";
import type { PreviewRow } from "@/components/marketing/terminal-preview";
import type { PricingPlan } from "@/components/marketing/pricing-cards";
import { logger, errorMessage } from "@/lib/log";

/** Illustrative rows shown only when no real signals exist yet; the UI labels them as not live. */
const ILLUSTRATIVE: PreviewRow[] = [
  ["solana", "ORCA-X", "momentum", 82, 0.42, 6.1, 18.4, 1_240_000, 3_900_000, 812, 361],
  ["base", "BLUEFN", "accumulation", 74, 0.0189, 0.8, 2.2, 1_900_000, 2_600_000, 640, 330],
  ["ethereum", "HALO", "breakout_watch", 69, 3.14, 0.6, -1.1, 5_600_000, 7_200_000, 410, 380],
  ["bsc", "LOTUS", "momentum", 66, 0.0056, 4.9, 12.7, 410_000, 860_000, 522, 268],
  ["ethereum", "DUSK", "distribution", 41, 0.88, -6.4, -13.9, 730_000, 1_400_000, 240, 470],
  ["solana", "TRAP", "high_risk", 12, 0.0093, 11.8, 84.2, 95_000, 410_000, 980, 41],
].map(([chain, symbol, type, score, price, h1, h24, liq, vol, buys, sells], i) => ({
  id: `illustrative-${i}`,
  chain: chain as string,
  symbol: symbol as string,
  name: symbol as string,
  logo: null,
  type: type as string,
  score: score as number,
  confidence: 70,
  price: price as number,
  h1: h1 as number,
  h24: h24 as number,
  liquidity: liq as number,
  volume: vol as number,
  buys: buys as number,
  sells: sells as number,
  createdAt: new Date().toISOString(),
  demo: true,
}));

export async function getPreviewRows(): Promise<{ rows: PreviewRow[]; live: boolean }> {
  try {
    const ent = await anonymousEntitlements();
    // Marketing preview shows all chains but with the Free plan's delay.
    const page = await listSignals(
      { chain: [], type: [], strength: [], sort: "score", pageSize: 12, status: "active" },
      { ...ent, features: { ...ent.features, chains: CHAIN_IDS, signal_history_days: 2 } },
    );
    const rows = page.rows
      .filter((r) => r.signal_type !== "high_risk" || page.rows.length < 6)
      .map((r) => ({
        id: r.id, chain: r.chain, symbol: r.symbol, name: r.name, logo: r.logo_url, type: r.signal_type, score: r.ai_score,
        confidence: r.confidence_score, price: r.price_usd, h1: r.price_change_h1, h24: r.price_change_h24, liquidity: r.liquidity_usd,
        volume: r.volume_h24, buys: r.buys_h1, sells: r.sells_h1, createdAt: new Date(r.created_at).toISOString(), demo: r.is_demo,
      }));
    if (rows.length >= 3 && !rows.some((r) => r.demo)) return { rows, live: true };
  } catch (err) {
    logger("marketing").warn("Preview rows unavailable", { error: errorMessage(err) });
  }
  return { rows: ILLUSTRATIVE, live: false };
}

export async function getPricingPlans(): Promise<PricingPlan[]> {
  const plans = await listPlans();
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    monthly: p.price_monthly_cents,
    annual: p.price_annual_cents,
    currency: p.currency,
    rows: featureRows(p.features),
  }));
}
