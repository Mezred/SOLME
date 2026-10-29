/**
 * SOLME deterministic scoring engine (pure functions, no I/O).
 *
 * Design rules:
 *  - Every factor returns a 0–100 score (higher = more favourable) or null when its inputs are missing.
 *    Missing factors are excluded and the remaining weights are renormalized — never imputed.
 *  - Quality, momentum, security risk and confidence are reported separately; the headline AI score is
 *    their documented combination, capped/penalized by security risk.
 *  - A bullish pattern is never assigned because price is rising alone: bullish types require buy pressure,
 *    volume confirmation, minimum liquidity and acceptable security.
 *  - The LLM never computes scores; it only explains the evidence produced here.
 */
import type { ScoringSettings } from "@/lib/settings";
import type { Candle, SecurityReport } from "@/lib/providers/types";

export const SCORING_VERSION = "v1";

export type FactorCategory = "quality" | "momentum" | "risk" | "context";

export interface FactorResult {
  key: string;
  category: FactorCategory;
  score: number | null;
  weight: number;
  evidence: Record<string, unknown>;
  reason: string;
  missing: boolean;
}

export interface ScoringInput {
  now: Date;
  capturedAt: Date;
  market: {
    priceUsd: number | null;
    priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null; d7: number | null };
    volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
    liquidityUsd: number | null;
    marketCap: number | null;
    fdv: number | null;
    txns: { h1: { buys: number; sells: number } | null; h24: { buys: number; sells: number } | null };
    pairCreatedAt: Date | null;
    promoted: boolean;
  };
  security: Pick<SecurityReport, "status" | "riskLevel" | "checks" | "checkedAt"> | null;
  holders: { count: number | null; top10Pct: number | null } | null;
  /** Net activity of wallets with documented labels. Null when no wallet data source is configured. */
  smartMoney: { labeledBuyers: number; labeledSellers: number } | null;
  /** 24h change of the chain's native asset, used as market-regime context. */
  regime: { nativeChangeH24: number | null } | null;
  candles: Candle[] | null;
}

export type SignalType = "momentum" | "accumulation" | "breakout_watch" | "distribution" | "high_risk";
export type Strength = "strong" | "moderate" | "weak" | "avoid";

export interface TradeScenario {
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  stopLoss: number;
  takeProfits: { label: string; price: number; rMultiple: number }[];
  atr: number;
  basis: string;
}

export interface ScoringResult {
  version: string;
  aiScore: number;
  qualityScore: number | null;
  momentumScore: number | null;
  riskScore: number;
  confidenceScore: number;
  factors: FactorResult[];
  signalType: SignalType | null;
  strength: Strength;
  riskFlags: string[];
  missingData: string[];
  stale: boolean;
  rationale: string;
  scenario: TradeScenario | null;
  eligibility: { eligible: boolean; reasons: string[] };
}

/** Documentation for the methodology page and admin weight editor. */
export const FACTOR_DOCS: Record<string, { label: string; category: FactorCategory; description: string; inputs: string }> = {
  price_momentum: { label: "Price momentum", category: "momentum", description: "Blended 1h/6h/24h change. Rewards steady positive trend; parabolic moves (>50% in 1h, >150% in 6h or >300% in 24h) are capped, flagged as overextended and cannot produce a bullish pattern.", inputs: "priceChange h1, h6, h24" },
  volume_acceleration: { label: "Volume acceleration", category: "momentum", description: "Last-hour volume relative to the 24h hourly average (log2 ratio).", inputs: "volume h1, h24" },
  buy_sell_imbalance: { label: "Buy/sell imbalance", category: "momentum", description: "Share of buy transactions over the last hour (weighted 70%) and 24h (30%). Requires ≥20 transactions. Counts transactions, not size: many small buys can coexist with large sells.", inputs: "txns h1, h24" },
  smart_money: { label: "Smart Money flow", category: "momentum", description: "Net buyers among wallets with a documented classification. Excluded when no wallet data source is configured.", inputs: "labeled wallet transactions" },
  liquidity_quality: { label: "Liquidity depth", category: "quality", description: "Log-scaled USD liquidity of the primary pair ($10k ≈ 20, $250k ≈ 70, $5M+ = 100).", inputs: "liquidity.usd" },
  liquidity_to_mcap: { label: "Liquidity / market cap", category: "quality", description: "Liquidity as a share of the larger of market cap and FDV. 5–30% is healthy; below 1% means price is easy to move. Pools of $1M+ are floored at 50 because established tokens trade mostly off-DEX.", inputs: "liquidity.usd, marketCap, fdv" },
  holder_distribution: { label: "Holder distribution", category: "quality", description: "Top-10 holder share excluding pools, locked and burn addresses.", inputs: "security provider holder list" },
  token_age: { label: "Pair age", category: "quality", description: "Older pairs have survived longer; pairs under 1 hour carry the highest uncertainty.", inputs: "pairCreatedAt" },
  trading_activity: { label: "Trading activity", category: "quality", description: "Log-scaled 24h transaction count.", inputs: "txns h24" },
  volatility: { label: "Volatility", category: "quality", description: "Standard deviation of candle returns; calmer price action scores higher.", inputs: "OHLCV candles" },
  market_regime: { label: "Market regime", category: "context", description: "24h change of the chain's native asset as broad risk-on/risk-off context.", inputs: "native asset priceChange h24" },
};

/** Pools at least this deep are not treated as "thin" relative to market cap. */
export const DEEP_LIQUIDITY_USD = 1_000_000;
/** Bullish patterns are not eligible for pairs younger than this; they are listed under New Launches instead. */
export const MIN_SIGNAL_AGE_HOURS = 1;

/** Parabolic in any window: these moves are flagged and never rewarded beyond a capped score. */
export function isOverextended(pc: { h1: number | null; h6: number | null; h24: number | null }): boolean {
  return (pc.h1 ?? 0) > 50 || (pc.h6 ?? 0) > 150 || (pc.h24 ?? 0) > 300;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round = (x: number) => Math.round(x);
const fmtPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
const usd = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(0)}`);

function factor(key: string, weight: number, score: number | null, evidence: Record<string, unknown>, reason: string): FactorResult {
  const doc = FACTOR_DOCS[key];
  return { key, category: doc.category, score: score === null ? null : round(clamp(score)), weight, evidence, reason, missing: score === null };
}

/** Piecewise-linear interpolation over sorted [x, y] points. */
function interp(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

export function computeFactors(input: ScoringInput, weights: Record<string, number>): FactorResult[] {
  const m = input.market;
  const w = (k: string) => weights[k] ?? 0;
  const out: FactorResult[] = [];

  // Price momentum
  {
    const { h1, h6, h24 } = m.priceChange;
    if (h1 === null && h6 === null && h24 === null) {
      out.push(factor("price_momentum", w("price_momentum"), null, {}, "No price change data"));
    } else {
      const blended = 0.5 * (h1 ?? 0) + 0.3 * ((h6 ?? 0) / 2) + 0.2 * ((h24 ?? 0) / 4);
      let s = 50 + 2.5 * blended;
      const overextended = isOverextended(m.priceChange);
      if (overextended) s = Math.min(s, 60);
      out.push(factor("price_momentum", w("price_momentum"), s, { h1, h6, h24, overextended },
        overextended ? `Parabolic move (1h ${fmtPct(h1 ?? 0)}, 24h ${fmtPct(h24 ?? 0)}) — overextended, capped` : `1h ${h1 === null ? "n/a" : fmtPct(h1)}, 6h ${h6 === null ? "n/a" : fmtPct(h6)}, 24h ${h24 === null ? "n/a" : fmtPct(h24)}`));
    }
  }

  // Volume acceleration
  {
    const { h1, h24 } = m.volume;
    if (h1 === null || !h24) {
      out.push(factor("volume_acceleration", w("volume_acceleration"), null, {}, "Insufficient volume data"));
    } else {
      const ratio = h1 / (h24 / 24);
      const s = 50 + 25 * Math.log2(Math.max(ratio, 1e-3));
      out.push(factor("volume_acceleration", w("volume_acceleration"), s, { volume_h1: h1, volume_h24: h24, ratio: Number(ratio.toFixed(2)) },
        `Last-hour volume is ${ratio.toFixed(2)}× the 24h hourly average`));
    }
  }

  // Buy/sell imbalance
  {
    const t1 = m.txns.h1;
    const t24 = m.txns.h24;
    const n1 = t1 ? t1.buys + t1.sells : 0;
    const n24 = t24 ? t24.buys + t24.sells : 0;
    if (n1 < 20 && n24 < 20) {
      out.push(factor("buy_sell_imbalance", w("buy_sell_imbalance"), null, { txns_h1: n1, txns_h24: n24 }, "Fewer than 20 transactions — sample too small"));
    } else {
      const s1 = n1 >= 20 ? t1!.buys / n1 : null;
      const s24 = n24 >= 20 ? t24!.buys / n24 : null;
      const share = s1 !== null && s24 !== null ? 0.7 * s1 + 0.3 * s24 : (s1 ?? s24)!;
      out.push(factor("buy_sell_imbalance", w("buy_sell_imbalance"), 50 + (share - 0.5) * 250,
        { buy_share: Number(share.toFixed(3)), buys_h1: t1?.buys ?? null, sells_h1: t1?.sells ?? null, buys_h24: t24?.buys ?? null, sells_h24: t24?.sells ?? null },
        `${(share * 100).toFixed(0)}% of recent transactions are buys`));
    }
  }

  // Smart money
  {
    const sm = input.smartMoney;
    if (!sm || sm.labeledBuyers + sm.labeledSellers === 0) {
      out.push(factor("smart_money", w("smart_money"), null, {}, sm ? "No labeled-wallet activity observed" : "No wallet data source configured"));
    } else {
      const net = (sm.labeledBuyers - sm.labeledSellers) / (sm.labeledBuyers + sm.labeledSellers);
      out.push(factor("smart_money", w("smart_money"), 50 + net * 45, { ...sm }, `${sm.labeledBuyers} labeled buyers vs ${sm.labeledSellers} sellers`));
    }
  }

  // Liquidity depth
  {
    const L = m.liquidityUsd;
    if (L === null) out.push(factor("liquidity_quality", w("liquidity_quality"), null, {}, "Liquidity not reported"));
    else {
      const s = interp(Math.log10(Math.max(L, 1)), [[3, 0], [4, 20], [4.7, 45], [5.4, 70], [6, 85], [6.7, 100]]);
      out.push(factor("liquidity_quality", w("liquidity_quality"), s, { liquidity_usd: L }, `${usd(L)} pooled liquidity`));
    }
  }

  // Liquidity / market cap
  {
    const L = m.liquidityUsd;
    // Providers sometimes report circulating cap below pool liquidity; use the larger valuation.
    const cap = Math.max(m.marketCap ?? 0, m.fdv ?? 0) || null;
    if (L === null || !cap) out.push(factor("liquidity_to_mcap", w("liquidity_to_mcap"), null, {}, "Market cap or liquidity not reported"));
    else {
      const r = (L / cap) * 100;
      let s = interp(r, [[0.2, 0], [1, 25], [5, 80], [15, 100], [30, 90], [60, 55], [100, 35]]);
      // Established tokens trade mostly off-DEX; with ≥$1M pooled the ratio stops being a thin-book warning.
      const deep = L >= DEEP_LIQUIDITY_USD;
      if (deep) s = Math.max(s, 50);
      out.push(factor("liquidity_to_mcap", w("liquidity_to_mcap"), s, { ratio_pct: Number(r.toFixed(2)), market_cap: cap, deep_pool: deep },
        `Liquidity is ${r < 0.1 ? r.toFixed(2) : r.toFixed(1)}% of market cap${deep ? " (deep pool; ratio de-emphasized)" : ""}`));
    }
  }

  // Holder distribution
  {
    const t = input.holders?.top10Pct ?? null;
    if (t === null) out.push(factor("holder_distribution", w("holder_distribution"), null, {}, "Holder distribution unavailable"));
    else {
      const s = interp(t, [[10, 98], [20, 85], [30, 70], [50, 35], [70, 10], [90, 0]]);
      out.push(factor("holder_distribution", w("holder_distribution"), s, { top10_pct: t, holder_count: input.holders?.count ?? null }, `Top 10 holders own ${t.toFixed(1)}%`));
    }
  }

  // Pair age
  {
    if (!m.pairCreatedAt) out.push(factor("token_age", w("token_age"), null, {}, "Pair creation time unknown"));
    else {
      const hours = (input.now.getTime() - m.pairCreatedAt.getTime()) / 3_600_000;
      const s = interp(hours, [[0, 5], [1, 15], [24, 35], [168, 60], [720, 75], [4320, 90]]);
      out.push(factor("token_age", w("token_age"), s, { age_hours: Number(hours.toFixed(1)) }, hours < 48 ? `Pair is ${hours.toFixed(1)} hours old` : `Pair is ${(hours / 24).toFixed(0)} days old`));
    }
  }

  // Trading activity
  {
    const t = m.txns.h24;
    if (!t) out.push(factor("trading_activity", w("trading_activity"), null, {}, "Transaction counts unavailable"));
    else {
      const n = t.buys + t.sells;
      const s = interp(Math.log10(Math.max(n, 1)), [[1, 5], [2, 30], [3, 60], [4, 85], [5, 100]]);
      out.push(factor("trading_activity", w("trading_activity"), s, { txns_h24: n }, `${n.toLocaleString("en-US")} transactions in 24h`));
    }
  }

  // Volatility
  {
    const c = input.candles;
    if (!c || c.length < 12) out.push(factor("volatility", w("volatility"), null, {}, "Not enough candle history"));
    else {
      const rets: number[] = [];
      for (let i = 1; i < c.length; i++) if (c[i - 1].close > 0) rets.push(Math.log(c[i].close / c[i - 1].close));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * 100;
      const s = interp(sd, [[0.5, 95], [2, 75], [5, 45], [10, 20], [20, 5]]);
      out.push(factor("volatility", w("volatility"), s, { stdev_pct: Number(sd.toFixed(2)), candles: c.length }, `Candle return volatility ${sd.toFixed(2)}%`));
    }
  }

  // Market regime
  {
    const r = input.regime?.nativeChangeH24 ?? null;
    if (r === null) out.push(factor("market_regime", w("market_regime"), null, {}, "Native asset data unavailable"));
    else {
      const s = interp(r, [[-10, 15], [-5, 30], [0, 55], [3, 70], [8, 85]]);
      out.push(factor("market_regime", w("market_regime"), s, { native_change_h24: r }, `Chain native asset ${fmtPct(r)} in 24h`));
    }
  }

  return out;
}

function weightedMean(factors: FactorResult[]): number | null {
  const avail = factors.filter((f) => f.score !== null && f.weight > 0);
  const total = avail.reduce((s, f) => s + f.weight, 0);
  if (total === 0) return null;
  return avail.reduce((s, f) => s + f.score! * f.weight, 0) / total;
}

const SECURITY_RISK: Record<string, number> = { low: 10, medium: 35, high: 65, critical: 95, unknown: 50 };

/** ATR-based scenario levels. Only produced when enough candles exist; otherwise null (never guessed). */
export function tradeScenario(price: number | null, candles: Candle[] | null): TradeScenario | null {
  if (!price || !candles || candles.length < 20) return null;
  const recent = candles.slice(-15);
  const trs = recent.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - recent[i].close), Math.abs(c.low - recent[i].close)));
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  if (!(atr > 0)) return null;
  const swingLow = Math.min(...candles.slice(-12).map((c) => c.low));
  const invalidation = price - swingLow > 3 * atr || swingLow >= price ? price - 2 * atr : swingLow;
  if (invalidation <= 0) return null;
  const entryLow = Math.max(invalidation * 1.005, price - 0.5 * atr);
  const entryHigh = price;
  const stopLoss = invalidation * 0.99;
  const entryMid = (entryLow + entryHigh) / 2;
  const R = entryMid - stopLoss;
  if (!(R > 0)) return null;
  return {
    entryLow,
    entryHigh,
    invalidation,
    stopLoss,
    takeProfits: [
      { label: "TP1", price: entryMid + 1.5 * R, rMultiple: 1.5 },
      { label: "TP2", price: entryMid + 3 * R, rMultiple: 3 },
    ],
    atr,
    basis: `ATR(14)=${atr.toPrecision(4)} on ${candles.length} candles; invalidation at recent swing low or 2×ATR`,
  };
}

export function scoreToken(input: ScoringInput, settings: ScoringSettings): ScoringResult {
  const th = settings.thresholds;
  const factors = computeFactors(input, settings.weights);
  const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));
  const m = input.market;

  const qualityScore = weightedMean(factors.filter((f) => f.category === "quality"));
  const momentumScore = weightedMean(factors.filter((f) => f.category === "momentum"));

  // ── risk ──
  const riskFlags: string[] = [];
  const sec = input.security;
  const secLevel = !sec || sec.status === "unavailable" || sec.status === "error" ? "unknown" : sec.riskLevel;
  let risk = SECURITY_RISK[secLevel];
  if (secLevel === "unknown") riskFlags.push("Security data unavailable — not verified clean");
  for (const c of sec?.checks ?? []) if (c.result === "fail") riskFlags.push(`${c.label}: ${c.detail}`);
  const ageH = m.pairCreatedAt ? (input.now.getTime() - m.pairCreatedAt.getTime()) / 3_600_000 : null;
  if (ageH !== null && ageH < 1) { risk += 10; riskFlags.push("Pair is less than 1 hour old"); }
  if (m.liquidityUsd !== null && m.liquidityUsd < th.min_liquidity_usd) { risk += 15; riskFlags.push(`Liquidity below ${usd(th.min_liquidity_usd)} minimum`); }
  if (byKey.price_momentum?.evidence.overextended) { risk += 10; riskFlags.push(`Overextended: 1h ${fmtPct(m.priceChange.h1 ?? 0)}, 24h ${fmtPct(m.priceChange.h24 ?? 0)}`); }
  const lr = byKey.liquidity_to_mcap?.evidence.ratio_pct as number | undefined;
  if (lr !== undefined && lr < 1 && !byKey.liquidity_to_mcap?.evidence.deep_pool) { risk += 10; riskFlags.push("Thin liquidity relative to market cap"); }
  if (m.promoted) riskFlags.push("Paid promotion active on DexScreener (not a sign of quality)");
  const stale = (input.now.getTime() - input.capturedAt.getTime()) / 60_000 > th.stale_after_minutes;
  if (stale) riskFlags.push("Market data is stale");
  const riskScore = round(clamp(risk));

  // ── headline score ──
  let ai = weightedMean(factors) ?? 0;
  const pen = settings.security_penalty;
  if (secLevel === "critical") ai = Math.min(ai, Math.max(0, 100 - pen.critical) + 15);
  else if (secLevel === "high") ai -= pen.high;
  else if (secLevel === "medium") ai -= pen.medium;
  else if (secLevel === "unknown") ai -= pen.unknown;
  const aiScore = round(clamp(ai));

  // ── confidence: data coverage × freshness × security availability ──
  const totalW = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const coverage = factors.filter((f) => !f.missing).reduce((s, f) => s + f.weight, 0) / totalW;
  let conf = coverage * 100;
  if (stale) conf *= 0.5;
  if (secLevel === "unknown") conf -= 15;
  const confidenceScore = round(clamp(conf));

  const missingData = factors.filter((f) => f.missing).map((f) => f.key);
  if (m.priceChange.d7 === null) missingData.push("price_change_7d");
  if (input.holders?.count == null) missingData.push("holder_count");

  // ── classification ──
  const share = byKey.buy_sell_imbalance?.evidence.buy_share as number | undefined;
  const volS = byKey.volume_acceleration?.score ?? null;
  const h1 = m.priceChange.h1;
  const h24 = m.priceChange.h24;
  let signalType: SignalType | null = null;
  if (secLevel === "critical" || riskScore >= 75) signalType = "high_risk";
  else if (share !== undefined && volS !== null && h1 !== null) {
    // Momentum needs real price expansion (≥3%/h); below that, buy pressure is accumulation.
    if ((momentumScore ?? 0) >= 65 && share >= 0.55 && volS >= 60 && h1 >= 3) signalType = "momentum";
    else if (share >= 0.58 && Math.abs(h1) < 3 && h24 !== null && h24 > -10 && h24 < 15 && volS >= 50) signalType = "accumulation";
    else if (share <= 0.42 && volS >= 55 && h1 < 0) signalType = "distribution";
    else if (volS >= 70 && Math.abs(h1) < 3) signalType = "breakout_watch";
  }

  let strength: Strength;
  if (signalType === "high_risk" || signalType === "distribution") strength = "avoid";
  else if (aiScore >= 80 && confidenceScore >= 70) strength = "strong";
  else if (aiScore >= 68 && confidenceScore >= 55) strength = "moderate";
  else strength = "weak";

  // ── eligibility: whether the pattern is trustworthy enough to act on ──
  const reasons: string[] = [];
  if (!signalType) reasons.push("No qualifying pattern");
  if (stale) reasons.push("Stale data");
  if (m.liquidityUsd === null || m.liquidityUsd < th.min_liquidity_usd) reasons.push("Below minimum liquidity");
  if (m.volume.h24 === null || m.volume.h24 < th.min_volume_h24_usd) reasons.push("Below minimum 24h volume");
  if (confidenceScore < th.min_confidence) reasons.push("Confidence below threshold");
  const bullish = signalType === "momentum" || signalType === "accumulation" || signalType === "breakout_watch";
  if (bullish && aiScore < th.min_score) reasons.push("Score below threshold");
  if (bullish && (secLevel === "high")) reasons.push("High security risk");
  if (bullish && (ageH === null || ageH < MIN_SIGNAL_AGE_HOURS)) reasons.push("Pair too new for a bullish pattern");
  if (bullish && byKey.price_momentum?.evidence.overextended) reasons.push("Overextended move");
  const eligible = reasons.length === 0;

  const scenario = bullish && eligible ? tradeScenario(m.priceUsd, input.candles) : null;

  const top = factors.filter((f) => !f.missing).sort((a, b) => b.score! * b.weight - a.score! * a.weight);
  const strongest = top.slice(0, 2).map((f) => f.reason.toLowerCase());
  const weakest = [...top].reverse().slice(0, 1).map((f) => f.reason.toLowerCase());
  const typeText: Record<SignalType, string> = {
    momentum: "Momentum with buy-side confirmation",
    accumulation: "Buy pressure without price expansion (possible accumulation)",
    breakout_watch: "Volume building while price compresses",
    distribution: "Sell pressure with rising volume (possible distribution)",
    high_risk: "High-risk conditions detected",
  };
  const rationale = [
    signalType ? typeText[signalType] : "No qualifying pattern",
    strongest.length ? `Strongest evidence: ${strongest.join("; ")}` : "",
    weakest.length ? `Weakest: ${weakest[0]}` : "",
    missingData.length ? `${missingData.length} data point(s) unavailable` : "",
  ].filter(Boolean).join(". ") + ".";

  return {
    version: settings.version || SCORING_VERSION,
    aiScore,
    qualityScore: qualityScore === null ? null : round(qualityScore),
    momentumScore: momentumScore === null ? null : round(momentumScore),
    riskScore,
    confidenceScore,
    factors,
    signalType,
    strength,
    riskFlags,
    missingData,
    stale,
    rationale,
    scenario,
    eligibility: { eligible, reasons },
  };
}
