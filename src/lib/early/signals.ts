/**
 * Early Coins: which fresh Solana coins show early signs of real activity, and why. Pure, no I/O.
 *
 * A coin is classified from independent, named signals, never from price alone:
 *  - activity: volume and transactions picking up against their own 6h pace, more buy transactions, many different
 *    wallets buying (counted from a sample of real pool trades, when one was taken);
 *  - quality: smart wallets bought, a proven dev launched it, a pool deep enough for its market cap;
 *  - price only as a small "rising, not vertical" signal.
 * Classes: Building Momentum (3+ signals: rising activity plus evidence about who is buying, i.e. smart wallets or a
 * proven dev; a deep pool only adds to the rank), Early Activity (activity rising),
 * High Risk (a critical finding or deteriorating conditions; shown separately, never ranked with the others).
 * The rank is the sum of the listed signal weights, so every position is explainable. Classes are descriptions of
 * what is happening now, not predictions.
 */

export type EarlyClass = "building" | "early" | "high_risk";

export interface EarlyFacts {
  priceUsd: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null };
  volume: { h1: number | null; h6: number | null };
  txns: { buysH1: number | null; sellsH1: number | null; buysH6: number | null; sellsH6: number | null };
  liquidityUsd: number | null;
  /** Highest liquidity in the last 2 hours (snapshots). */
  liquidityPeakUsd: number | null;
  marketCapUsd: number | null;
  ageHours: number | null;
  /** Latest contract check: risk level, or null when never checked. */
  contractRisk: string | null;
  /** Launch scam check (launchpad coins): true / false / null (none). */
  launchCheckPassed: boolean | null;
  devScore: number | null;
  devLaunches: number | null;
  devSoldPct: number | null;
  smartWallets: number;
  smartSol: number;
  /** Minutes since the market data was captured. */
  dataAgeMinutes: number;
  /** Whether smart-wallet and launch data can exist at all (Helius configured). */
  onchainData: boolean;
  /** Unique buyers in a sample of the latest pool trades, or null when no sample was taken. */
  wallets?: { buyers: number; trades: number; spanMinutes: number | null; ageMinutes: number } | null;
}

export interface Signal {
  key: "volume" | "txns" | "buyers" | "wallets" | "trend" | "smart" | "dev" | "depth";
  family: "activity" | "quality" | "price";
  weight: number;
  text: string;
}

export interface Flag {
  key: string;
  /** critical: makes the coin High Risk; caution: shown on the card. */
  level: "critical" | "caution";
  text: string;
}

export interface EarlyResult {
  cls: EarlyClass | null;
  rank: number;
  signals: Signal[];
  flags: Flag[];
  /** One sentence: why the coin is here. */
  why: string;
  /** Plain status of the contract and launch checks. */
  check: "ok" | "risk" | "unchecked";
  /** What could not be measured. */
  missing: string[];
}

export const EARLY_MAX_AGE_HOURS = 72;
/** Below this the coin is excluded: there is no realistic way out. */
export const MIN_LIQUIDITY_USD = 5_000;
/** Market data older than this is not shown as current. */
export const STALE_MINUTES = 30;
export const PROVEN_DEV = 60;
/** A trade sample older than this is not used. */
export const WALLETS_MAX_AGE_MINUTES = 30;
/** Many different buyers within the sample's time span (at most 90 minutes) is real demand. */
const MANY_BUYERS = 25;
/** This few buyers across a busy sample means a handful of wallets (often bots) make the activity. */
const FEW_BUYERS = 5;
const BUSY_SAMPLE = 40;

const k = (usd: number) => (usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(1)}M` : usd >= 1_000 ? `$${Math.round(usd / 1000)}k` : `$${Math.round(usd)}`);
const x = (v: number) => `${v.toFixed(1)}×`;

/** Pure: signals, flags and class for one coin. `cls` is null when it does not belong in the feed. */
export function classifyEarly(f: EarlyFacts): EarlyResult {
  const missing: string[] = [];
  const signals: Signal[] = [];
  const flags: Flag[] = [];
  const liq = f.liquidityUsd;
  const empty = (why: string): EarlyResult => ({ cls: null, rank: 0, signals: [], flags: [{ key: "excluded", level: "critical", text: why }], why, check: "unchecked", missing });

  if (f.dataAgeMinutes > STALE_MINUTES) return empty("Market data is stale");
  if (liq === null || liq < MIN_LIQUIDITY_USD) return empty("Liquidity too thin to trade");
  if (f.ageHours !== null && f.ageHours > EARLY_MAX_AGE_HOURS) return empty("Older than 3 days");

  // Activity against the coin's own pace (last hour vs the average hour of the last 6).
  const volH1 = f.volume.h1 ?? 0;
  const volPace = f.volume.h6 ? f.volume.h6 / 6 : null;
  if (volPace && volH1 >= 5_000 && volH1 >= 1.8 * volPace) {
    signals.push({ key: "volume", family: "activity", weight: 2, text: `Volume ${x(volH1 / volPace)} its 6h pace (${k(volH1)} in 1h)` });
  }
  const tH1 = (f.txns.buysH1 ?? 0) + (f.txns.sellsH1 ?? 0);
  const tH6 = (f.txns.buysH6 ?? 0) + (f.txns.sellsH6 ?? 0);
  if (f.txns.buysH6 === null) missing.push("6h transaction history");
  if (tH6 > 0 && tH1 >= 60 && tH1 >= 1.8 * (tH6 / 6)) {
    signals.push({ key: "txns", family: "activity", weight: 1.5, text: `Transactions ${x(tH1 / (tH6 / 6))} their 6h pace (${tH1} in 1h)` });
  }
  const buys = f.txns.buysH1 ?? 0;
  const share = tH1 > 0 ? buys / tH1 : 0;
  const buyPace = f.txns.buysH6 ? f.txns.buysH6 / 6 : null;
  if (tH1 >= 50 && share >= 0.55 && buyPace && buys >= 1.5 * buyPace) {
    signals.push({ key: "buyers", family: "activity", weight: 1.5, text: `Buy transactions up ${x(buys / buyPace)}, ${Math.round(share * 100)}% of trades` });
  }
  // Distinct wallets, from real trades: confirms the activity is many people, or shows it is a few wallets.
  const w = f.wallets && f.wallets.ageMinutes <= WALLETS_MAX_AGE_MINUTES ? f.wallets : null;
  if (!w) {
    if (f.onchainData) missing.push("unique buyers (no recent trade sample)");
  }
  else if (w.trades >= BUSY_SAMPLE && w.buyers <= FEW_BUYERS) {
    // Bot-made activity: the transaction-based signals would count it as interest.
    for (let i = signals.length - 1; i >= 0; i--) if (signals[i].key === "txns" || signals[i].key === "buyers") signals.splice(i, 1);
    flags.push({ key: "few", level: "caution", text: `Only ${w.buyers} wallet${w.buyers === 1 ? "" : "s"} bought across the last ${w.trades} trades` });
  } else if (w.buyers >= MANY_BUYERS && w.spanMinutes !== null && w.spanMinutes <= 90) {
    signals.push({ key: "wallets", family: "activity", weight: 1.5, text: `${w.buyers} different wallets bought in the last ${w.spanMinutes} min` });
  }
  const m5 = f.change.m5 ?? 0;
  const h1 = f.change.h1;
  if (h1 !== null && h1 >= 5 && h1 < 150 && m5 > -10 && m5 < 30) {
    signals.push({ key: "trend", family: "price", weight: 0.5, text: `Rising steadily (+${Math.round(h1)}% in 1h, not vertical)` });
  }

  // Quality.
  if (!f.onchainData) missing.push("smart-wallet and launch data (no Helius key)");
  if (f.smartWallets > 0) {
    signals.push({ key: "smart", family: "quality", weight: f.smartWallets >= 2 ? 3 : 2.5, text: `${f.smartWallets} smart wallet${f.smartWallets > 1 ? "s" : ""} bought${f.smartSol > 0 ? ` (${f.smartSol.toFixed(1)} SOL)` : ""}` });
  }
  if (f.devScore !== null && f.devScore >= PROVEN_DEV) {
    signals.push({ key: "dev", family: "quality", weight: 2, text: `Proven dev (score ${f.devScore}${f.devLaunches ? `, ${f.devLaunches} launch${f.devLaunches === 1 ? "" : "es"}` : ""})` });
  }
  const ratio = f.marketCapUsd && liq > 0 ? f.marketCapUsd / liq : null;
  if (liq >= 30_000 && ratio !== null && ratio <= 10) {
    signals.push({ key: "depth", family: "quality", weight: 1, text: `Deep pool for its size (${k(liq)}, market cap ${ratio.toFixed(1)}× liquidity)` });
  }

  // Risk: critical findings and deteriorating conditions.
  const risky = f.contractRisk === "high" || f.contractRisk === "critical";
  if (risky) flags.push({ key: "contract", level: "critical", text: `Contract check: ${f.contractRisk} risk` });
  if (f.launchCheckPassed === false) flags.push({ key: "launch", level: "critical", text: "Failed the launch scam check" });
  if (f.liquidityPeakUsd && liq < 0.6 * f.liquidityPeakUsd) flags.push({ key: "liquidity", level: "critical", text: `Liquidity down ${Math.round((1 - liq / f.liquidityPeakUsd) * 100)}% in 2h` });
  if (h1 !== null && h1 <= -40) flags.push({ key: "dump", level: "critical", text: `Price down ${Math.round(-h1)}% in 1h` });
  if (ratio !== null && ratio >= 40) flags.push({ key: "thin", level: "critical", text: `Market cap ${Math.round(ratio)}× liquidity: very easy to dump` });
  if (f.devSoldPct !== null && f.devSoldPct >= 5) flags.push({ key: "devsold", level: "critical", text: `Dev sold ${f.devSoldPct.toFixed(1)}% of supply` });
  if (f.contractRisk === null) {
    flags.push({ key: "unchecked", level: "caution", text: "Contract not checked yet" });
    missing.push("contract check");
  }
  if (ratio !== null && ratio >= 20 && ratio < 40) flags.push({ key: "thin", level: "caution", text: `Market cap ${Math.round(ratio)}× liquidity` });
  if (m5 >= 40 || (h1 ?? 0) >= 300) flags.push({ key: "vertical", level: "caution", text: "Vertical move: chasing is risky" });
  if (liq < 15_000) flags.push({ key: "smallpool", level: "caution", text: `Small pool (${k(liq)}): exits slip` });

  signals.sort((a, b) => b.weight - a.weight);
  const check: EarlyResult["check"] = risky || f.launchCheckPassed === false ? "risk" : f.contractRisk === null ? "unchecked" : "ok";
  const activity = signals.filter((s) => s.family === "activity");
  const backed = signals.some((s) => s.key === "smart" || s.key === "dev");
  const critical = flags.some((g) => g.level === "critical");
  const cls: EarlyClass | null =
    critical ? (signals.length ? "high_risk" : null)
    : signals.length >= 3 && activity.length > 0 && backed ? "building"
    : activity.length > 0 ? "early"
    : null;
  const rank = Math.round(signals.reduce((sum, s) => sum + s.weight, 0) * 10) / 10;
  const why =
    cls === "high_risk" ? `${flags.find((g) => g.level === "critical")!.text}, despite ${signals[0].text.charAt(0).toLowerCase() + signals[0].text.slice(1)}`
    : signals.slice(0, 2).map((s) => s.text).join(" · ") || "No signal";
  return { cls, rank, signals, flags, why, check, missing };
}
