/**
 * Pre-buy decision engine for Solana memecoins — pure, no I/O. Turns what SOLME knows about a coin into one verdict
 * (tradeable / candidate / watch / avoid), a pass/warn/fail safety gate, memecoin timing, the exit cost, the reasons
 * to buy ("edges") and a one-line headline.
 *
 * Rules (a research summary, not advice):
 *  - Any safety FAIL ⇒ AVOID: contract, liquidity, exit, holders, dev wallet, launch bundle, snipers still holding,
 *    a serial-launcher dev, or a dev dumping a fresh coin.
 *  - TRADEABLE needs: contract verified clean, at most one warning, no blocking unknowns, timing early or mid-move
 *    (not parabolic, not dumping), the holder check done, and at least one reason to buy (smart wallets bought,
 *    a proven dev, or strong buy flow). Without holder data the same coin is a CANDIDATE.
 *  - Everything else ⇒ WATCH, with the reason in the headline.
 * Holder and dev checks can only make a verdict stricter.
 */

import type { Investigation } from "@/lib/tokens/investigate";

export type Verdict = "tradeable" | "candidate" | "watch" | "avoid";
export type GateStatus = "pass" | "warn" | "fail" | "unknown";
export type Timing = "early" | "mid-move" | "overextended" | "dumping" | "unknown";

export interface GateItem {
  key: "contract" | "transfer" | "sell" | "liquidity" | "pool" | "exit" | "flow" | "trading" | "concentration" | "dev" | "bundle" | "snipers" | "insiders" | "devrecord" | "devsold";
  label: string;
  status: GateStatus;
  detail: string;
  /** How SOLME knows: read on-chain or simulated (confirmed), deduced from patterns (inferred), or not measured. */
  basis?: Basis;
}

export type Basis = "confirmed" | "inferred" | "unavailable";
export type RiskLevel = "low" | "moderate" | "high" | "critical";

/** Findings deduced from patterns rather than read directly (wallet links, fake volume, sells inferred from balances). */
const INFERRED = new Set<GateItem["key"]>(["insiders", "trading", "devsold"]);
/** A failure here can trap a buyer outright: no way out, or the pool can be taken. */
const TRAP = new Set<GateItem["key"]>(["sell", "transfer", "contract", "liquidity", "pool", "exit"]);

export const RISK_TEXT: Record<RiskLevel, { label: string; line: string }> = {
  low: { label: "Low", line: "No problems found in the checks that ran. That is not a guarantee: most new coins still fail." },
  moderate: { label: "Moderate", line: "Nothing critical, but there are caution points or checks that could not run." },
  high: { label: "High", line: "A serious finding: insiders, the dev or the market behaviour point to elevated risk." },
  critical: { label: "Critical", line: "You may not be able to sell, or the pool can be pulled. Treat it as a trap." },
};

export interface DecisionInput {
  priceUsd: number | null;
  change: { m5?: number | null; h1: number | null; h6: number | null; h24: number | null };
  liquidityUsd: number | null;
  marketCapUsd?: number | null;
  /** Hours since the main pair was created. */
  ageHours?: number | null;
  /** Bonding-curve pairs report no liquidity; sells go back to the curve. */
  onBondingCurve?: boolean;
  buysH1: number | null;
  sellsH1: number | null;
  security: { riskLevel: string | null; failedChecks: string[]; warnings?: string[] } | null;
  /** Holder & launch analysis (full check). */
  holders?: {
    top10WalletPct: number;
    devPct: number | null;
    bundlePct: number | null;
    /** % of supply still held by launch-block and first-seconds buyers. */
    launchBuyersHoldPct?: number | null;
    sniperPct?: number | null;
    devBuyPct?: number | null;
  } | null;
  /** The creator's launch record (launchpad coins). */
  dev?: { launches: number; migrated: number; score: number | null } | null;
  /** % of supply the creator has sold (recorded sells, or launch buy minus current balance). */
  devSoldPct?: number | null;
  /** Smart wallets (score 60+, not bots) that bought in the last 24h. */
  smartWallets?: { wallets: number; sol: number } | null;
  /** Sell simulation, connected holders, pool depth and trading patterns (full check). */
  investigation?: Investigation | null;
  /** Trade size used for the exit check, USD. */
  tradeSizeUsd?: number;
  /** Scenario levels, when measured levels exist. */
  plan?: { entryLow: number | null; entryHigh: number | null; stop: number | null; target: number | null } | null;
}

/** The five questions Coin Check answers, each from its gate items. */
export const QUESTIONS = [
  { key: "sell", question: "Can I sell it?", gates: ["sell", "transfer", "exit"] },
  { key: "liquidity", question: "Is the liquidity real?", gates: ["liquidity", "pool"] },
  { key: "control", question: "Who controls it?", gates: ["contract", "dev", "devrecord"] },
  { key: "insiders", question: "Are insiders set to dump?", gates: ["concentration", "bundle", "snipers", "devsold", "insiders"] },
  { key: "trading", question: "Is the trading genuine?", gates: ["trading", "flow"] },
] as const satisfies readonly { key: string; question: string; gates: readonly GateItem["key"][] }[];

export interface Section {
  key: (typeof QUESTIONS)[number]["key"];
  question: string;
  status: GateStatus;
  /** 0–100: 100 = every item passed. */
  score: number;
  items: GateItem[];
}

export interface Decision {
  verdict: Verdict;
  /** One line: the verdict and its main reason. */
  headline: string;
  reasons: string[];
  /** Reasons to buy that SOLME measured (smart wallets, proven dev, buy flow). */
  edges: string[];
  gate: GateItem[];
  timing: Timing;
  exit: { tradeSizeUsd: number; slippagePct: number | null };
  plan: { entryLow: number; entryHigh: number; stop: number; target: number | null; stopDistancePct: number } | null;
  fullCheck: boolean;
  /** The five questions, answered. */
  sections: Section[];
  /** 0–100 across the five questions; capped low when anything failed. */
  safetyScore: number;
  /** What would have to change for a better verdict (Watch / Candidate). */
  next: string[];
  /** Overall risk, separate from momentum or reasons to buy. */
  risk: RiskLevel;
  /** The three findings that matter most, worst first. */
  findings: GateItem[];
}

/** A typical memecoin entry; the exit check asks what selling it back costs. */
export const DEFAULT_TRADE_USD = 500;
const LIQ_FAIL = 5_000;
const LIQ_THIN = 15_000;
/** Market cap at this multiple of the pool: big holders cannot exit without crashing it. */
const MCAP_LIQ_WARN = 25;
const EXIT_WARN = 6;
const EXIT_FAIL = 15;
/** Sellers in control below this buy share (with enough trades to judge). */
const MIN_BUY_SHARE = 0.4;
/** Buy counts are cheap to inflate with bot micro-buys, so flow only counts as a reason to buy when it is lopsided and busy. */
const STRONG_BUY_SHARE = 0.6;
const MIN_FLOW_TRADES = 20;
const STRONG_FLOW_TRADES = 100;
export const PROVEN_DEV = 60;
/** Unknowns that are reported but never block (an unmeasured caveat rather than a risk). */
const SOFT_UNKNOWN = new Set<GateItem["key"]>(["flow", "devrecord", "sell", "pool", "insiders", "trading"]);
/** Contract findings that can stop a sale (as opposed to who controls the token). */
const TRANSFER_FINDING = /freeze|frozen|transfer hook|permanent delegate|transfer fee|pause|non-transferable|honeypot/i;

/** Price impact of selling `size` USD into a constant-product pool with `liquidity` USD total (half per side). */
export function estimateSlippagePct(size: number, liquidity: number | null): number | null {
  if (!liquidity || liquidity <= 0) return null;
  const side = liquidity / 2;
  return (size / (side + size)) * 100;
}

/** Memecoin timing: candles of +100% are normal; what matters is chasing a vertical move or catching a dump. */
export function timingOf(c: DecisionInput["change"]): Timing {
  const m5 = c.m5 ?? null;
  if (m5 === null && c.h1 === null && c.h6 === null && c.h24 === null) return "unknown";
  if ((c.h1 ?? 0) <= -40 || (m5 ?? 0) <= -25) return "dumping";
  if ((m5 ?? 0) >= 40 || (c.h1 ?? 0) >= 300 || (c.h6 ?? 0) >= 1000) return "overextended";
  if ((m5 ?? 0) >= 20 || (c.h1 ?? 0) >= 100 || (c.h6 ?? 0) >= 300) return "mid-move";
  return "early";
}

const k = (usd: number) => (usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(1)}M` : `$${Math.round(usd / 1000)}k`);
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

export function decide(input: DecisionInput): Decision {
  const gate: GateItem[] = [];
  const tradeSizeUsd = input.tradeSizeUsd ?? DEFAULT_TRADE_USD;

  // Contract (mint/freeze authority, Token-2022 extensions, LP, GoPlus): failed checks or high/critical ⇒ fail.
  const sec = input.security;
  // With SOLME's own holder check, the provider's holder-concentration finding is judged there (not twice): drop it
  // and re-derive the level from what is left, as the provider does (a fail or 3+ warnings is high).
  const own = Boolean(input.holders) && sec?.warnings !== undefined;
  const notHolders = (l: string) => !(own && /^Top-10 holder concentration/i.test(l));
  const failed = sec ? sec.failedChecks.filter(notHolders) : [];
  const warned = sec?.warnings?.filter(notHolders) ?? [];
  const level = !sec?.riskLevel || !own || sec.riskLevel === "critical" || sec.riskLevel === "unknown" ? sec?.riskLevel ?? null
    : failed.length || warned.length >= 3 ? "high" : warned.length ? "medium" : "low";
  if (!sec || !level || level === "unknown") {
    gate.push({ key: "contract", label: "Contract", status: "unknown", detail: "Not verified yet — treat as unsafe until checked" });
  } else if (sec.warnings !== undefined) {
    // Full findings: split who controls the token (authorities) from what can stop a sale (transfer restrictions).
    const isT = (l: string) => TRANSFER_FINDING.test(l);
    const cf = failed.filter((l) => !isT(l));
    const cw = warned.filter((l) => !isT(l));
    const tf = failed.filter(isT);
    const tw = warned.filter(isT);
    // A high/critical level without itemised findings still fails (the provider saw something we cannot name).
    const unnamed = (level === "critical" || level === "high") && !failed.length && !warned.length;
    gate.push(
      unnamed ? { key: "contract", label: "Authorities", status: "fail", detail: `${level} risk` }
      : cf.length || cw.length >= 3 ? { key: "contract", label: "Authorities", status: "fail", detail: [...cf, ...cw].slice(0, 2).join("; ") }
      : cw.length ? { key: "contract", label: "Authorities", status: "warn", detail: cw.slice(0, 2).join("; ") }
      : { key: "contract", label: "Authorities", status: "pass", detail: "Mint authority revoked, no balance control" },
    );
    gate.push(
      tf.length ? { key: "transfer", label: "Transfers", status: "fail", detail: tf.slice(0, 2).join("; ") }
      : tw.length ? { key: "transfer", label: "Transfers", status: "warn", detail: tw.slice(0, 2).join("; ") }
      : { key: "transfer", label: "Transfers", status: "pass", detail: "No freeze, transfer hook, delegate or transfer tax" },
    );
  } else if (failed.length || level === "high" || level === "critical") {
    gate.push({ key: "contract", label: "Contract", status: "fail", detail: failed.slice(0, 2).join("; ") || warned.slice(0, 2).join("; ") || `${level} risk` });
  } else if (level === "medium") {
    gate.push({ key: "contract", label: "Contract", status: "warn", detail: warned.length ? warned.slice(0, 2).join("; ") : "Medium-risk findings — read the security panel" });
  } else {
    gate.push({ key: "contract", label: "Contract", status: "pass", detail: "No mint/freeze authority or other red flags" });
  }

  // Liquidity, pool depth and exit.
  const liq = input.liquidityUsd;
  const ratio = liq && liq > 0 && input.marketCapUsd ? input.marketCapUsd / liq : null;
  if (input.onBondingCurve && liq === null) {
    gate.push({ key: "liquidity", label: "Liquidity", status: "pass", detail: "On the bonding curve — sells go back to the curve, no pool to pull" });
  } else if (liq === null) {
    gate.push({ key: "liquidity", label: "Liquidity", status: "unknown", detail: "Liquidity not reported" });
  } else if (liq < LIQ_FAIL) {
    gate.push({ key: "liquidity", label: "Liquidity", status: "fail", detail: `Only $${Math.round(liq).toLocaleString("en-US")} — too thin to get out` });
  } else if (liq < LIQ_THIN) {
    gate.push({ key: "liquidity", label: "Liquidity", status: "warn", detail: `${k(liq)} — thin pool, exits slip` });
  } else if (ratio !== null && ratio >= MCAP_LIQ_WARN) {
    gate.push({ key: "liquidity", label: "Liquidity", status: "warn", detail: `${k(liq)}, but market cap is ${Math.round(ratio)}× the pool — easy to dump` });
  } else {
    gate.push({ key: "liquidity", label: "Liquidity", status: "pass", detail: `${k(liq)} pooled${ratio !== null ? ` (market cap ${ratio.toFixed(1)}× the pool)` : ""}` });
  }
  const inv = input.investigation ?? null;
  const sim = inv?.sell.status === "ok" && inv.sell.impactPct !== null ? inv.sell : null;
  const slip = sim ? sim.impactPct : estimateSlippagePct(tradeSizeUsd, liq);
  if (slip !== null) {
    const size = sim?.amountUsd ? Math.round(sim.amountUsd) : tradeSizeUsd;
    gate.push({ key: "exit", label: "Exit cost", status: slip > EXIT_FAIL ? "fail" : slip > EXIT_WARN ? "warn" : "pass", detail: `Selling $${size} moves price ~${slip.toFixed(1)}%${sim ? " (real route)" : ""}` });
  }

  // Order flow (last hour).
  const total = (input.buysH1 ?? 0) + (input.sellsH1 ?? 0);
  const share = input.buysH1 !== null && input.sellsH1 !== null && total > 0 ? input.buysH1 / total : null;
  if (share !== null && total >= MIN_FLOW_TRADES) {
    const shown = share < MIN_BUY_SHARE ? Math.floor(share * 100) : Math.round(share * 100);
    gate.push({ key: "flow", label: "Order flow", status: share >= MIN_BUY_SHARE ? "pass" : "warn", detail: `${shown}% of ${total} trades in the last hour are buys${share < MIN_BUY_SHARE ? " — sellers in control" : ""}` });
  } else {
    gate.push({ key: "flow", label: "Order flow", status: "unknown", detail: "Too few trades in the last hour to judge" });
  }

  // Holders and launch (full check).
  const h = input.holders;
  if (h) {
    gate.push({ key: "concentration", label: "Top 10 wallets", status: h.top10WalletPct >= 45 ? "fail" : h.top10WalletPct >= 30 ? "warn" : "pass", detail: `Hold ${pct(h.top10WalletPct)} (pools excluded)` });
    if (h.devPct !== null) gate.push({ key: "dev", label: "Dev wallet", status: h.devPct >= 10 ? "fail" : h.devPct >= 5 ? "warn" : "pass", detail: `Holds ${pct(h.devPct)}` });
    if (h.bundlePct !== null) {
      // A bundle that has already sold out is history (a warning); one that still holds can still dump on buyers.
      const exited = h.launchBuyersHoldPct != null && h.launchBuyersHoldPct < 5;
      const status: GateStatus = h.bundlePct >= 20 ? (exited ? "warn" : "fail") : h.bundlePct >= 10 ? "warn" : "pass";
      gate.push({ key: "bundle", label: "Launch bundle", status, detail: `${pct(h.bundlePct)} bought in the launch block${h.bundlePct >= 10 && exited ? " (already sold)" : ""}` });
    }
    if (h.launchBuyersHoldPct != null) {
      const held = h.launchBuyersHoldPct;
      gate.push({
        key: "snipers",
        label: "Snipers",
        status: held >= 25 ? "fail" : held >= 12 ? "warn" : "pass",
        detail: `${h.sniperPct != null ? `Bought ${pct(h.sniperPct)} in the first seconds; ` : ""}launch buyers still hold ${pct(held)}`,
      });
    }
  }

  // The creator: launch record and whether they are selling.
  const dev = input.dev;
  if (dev) {
    if (dev.score !== null && dev.score >= PROVEN_DEV) {
      gate.push({ key: "devrecord", label: "Dev record", status: "pass", detail: `Proven dev: ${dev.launches} launches, ${dev.migrated} migrated (score ${dev.score})` });
    } else if (dev.migrated === 0 && dev.launches >= 10) {
      gate.push({ key: "devrecord", label: "Dev record", status: "fail", detail: `Serial launcher: ${dev.launches} coins, none migrated` });
    } else if (dev.migrated === 0 && dev.launches >= 3) {
      gate.push({ key: "devrecord", label: "Dev record", status: "warn", detail: `${dev.launches} coins launched, none migrated` });
    } else {
      gate.push({ key: "devrecord", label: "Dev record", status: "unknown", detail: dev.launches <= 1 ? "First launch — no record yet" : `${dev.launches} launches, ${dev.migrated} migrated` });
    }
  }
  const sold = input.devSoldPct ?? null;
  if (sold !== null && sold >= 1) {
    // Launchpad devs often sell a small first bag; a large early sale is the classic rug.
    const fresh = input.ageHours != null && input.ageHours < 2 && sold >= 3;
    gate.push({ key: "devsold", label: "Dev selling", status: fresh ? "fail" : "warn", detail: fresh ? `Dev already sold ${pct(sold)} of supply in the first hours` : `Dev sold ${pct(sold)} of supply` });
  }

  // The investigation: sell test, pool depth, connected holders, trading patterns.
  if (inv) {
    const s = inv.sell;
    if (s.status === "ok") {
      const tax = s.taxPct ?? 0;
      const got = s.receivedUsd !== null ? `$${Math.round(s.receivedUsd)}` : "SOL";
      gate.push({ key: "sell", label: "Sell test", status: tax >= 10 ? "fail" : tax >= 3 ? "warn" : "pass", detail: `Simulated selling $${Math.round(s.amountUsd ?? 0)} → ${got} received${tax >= 3 ? ` — hidden tax ~${Math.round(tax)}%` : ", no hidden tax"}` });
    } else if (s.status === "fails") {
      gate.push({ key: "sell", label: "Sell test", status: "fail", detail: `Simulated sell fails: ${s.reason ?? "reverted"}` });
    } else {
      gate.push({ key: "sell", label: "Sell test", status: "unknown", detail: s.status === "no_route" ? "No sell route on Jupiter yet" : `Not run${s.reason ? ` (${s.reason})` : ""}` });
    }

    const p = inv.pool;
    if (p.status === "ok" && !(input.onBondingCurve && liq === null)) {
      const drop = p.dropPct ?? 0;
      const amount = p.quoteAmount !== null ? `${p.quoteAmount < 100 ? p.quoteAmount.toFixed(1) : Math.round(p.quoteAmount).toLocaleString("en-US")} ${p.quoteSymbol} real in the pool` : "Backed by SOL/USDC";
      gate.push(
        drop >= 60 ? { key: "pool", label: "Pool", status: "fail", detail: `Liquidity pulled: −${Math.round(drop)}% in the last 3h` }
        : p.realQuote === false ? { key: "pool", label: "Pool", status: "warn", detail: `Paired with ${p.quoteSymbol}, not SOL/USDC — its value rides on another token` }
        : drop >= 30 ? { key: "pool", label: "Pool", status: "warn", detail: `Liquidity down ${Math.round(drop)}% in the last 3h` }
        : { key: "pool", label: "Pool", status: "pass", detail: `${amount}${p.pools > 1 ? ` · ${p.pools} pools` : ""}${p.dropPct !== null ? " · none pulled" : ""}` },
      );
    }

    const i = inv.insiders;
    if (i.status === "ok") {
      const big = i.clusters[0];
      const w = (n: number) => `${n} wallet${n === 1 ? "" : "s"}`;
      gate.push(
        i.devLinked.pct >= 10 ? { key: "insiders", label: "Connected wallets", status: "fail", detail: `${w(i.devLinked.wallets)} linked to the dev hold ${pct(i.devLinked.pct)} (hidden supply)` }
        : big && big.pct >= 20 ? { key: "insiders", label: "Connected wallets", status: "fail", detail: `${w(big.wallets)} funded by one wallet hold ${pct(big.pct)}` }
        : i.devLinked.pct >= 3 ? { key: "insiders", label: "Connected wallets", status: "warn", detail: `${w(i.devLinked.wallets)} linked to the dev hold ${pct(i.devLinked.pct)}` }
        : big && big.pct >= 8 ? { key: "insiders", label: "Connected wallets", status: "warn", detail: `${w(big.wallets)} funded by one wallet hold ${pct(big.pct)}` }
        : i.newWallets.pct >= 25 ? { key: "insiders", label: "Connected wallets", status: "warn", detail: `${w(i.newWallets.wallets)} under 3 days old hold ${pct(i.newWallets.pct)}` }
        : { key: "insiders", label: "Connected wallets", status: "pass", detail: `Top ${i.checked} holders traced: no dev links or shared funders` },
      );
    } else {
      gate.push({ key: "insiders", label: "Connected wallets", status: "unknown", detail: "Holder funding not traced" });
    }

    const t = inv.trading;
    if (t.status === "ok" && t.trades >= 10) {
      gate.push(
        // Fake volume misleads about demand but does not trap a buyer: a warning (and it cancels buy flow as an edge).
        t.dustPct >= 50 ? { key: "trading", label: "Trading", status: "warn", detail: `Volume bots: ${pct(t.dustPct)} of recent trades are dust-size, so trade counts are inflated` }
        : t.washPct >= 25 ? { key: "trading", label: "Trading", status: "warn", detail: `${pct(t.washPct)} of recent volume is wallets buying and selling straight back (fake volume)` }
        : t.topWalletPct >= 40 ? { key: "trading", label: "Trading", status: "warn", detail: `One wallet made ${pct(t.topWalletPct)} of recent volume` }
        : t.trades >= 50 && t.traders / t.trades < 0.25 ? { key: "trading", label: "Trading", status: "warn", detail: `Only ${t.traders} wallets made ${t.trades} trades` }
        : { key: "trading", label: "Trading", status: "pass", detail: `${t.trades} trades by ${t.traders} wallets${t.spanMinutes ? ` in ${t.spanMinutes} min` : ""}, no wash or bot pattern` },
      );
    } else {
      gate.push({ key: "trading", label: "Trading", status: "unknown", detail: t.status === "ok" ? "Too few recent trades to judge" : "Recent trades not analysed" });
    }
  }

  // Reasons to buy.
  const edges: string[] = [];
  const sw = input.smartWallets;
  if (sw && sw.wallets > 0) edges.push(`${sw.wallets} smart wallet${sw.wallets > 1 ? "s" : ""} bought${sw.sol > 0 ? ` (${sw.sol.toFixed(1)} SOL)` : ""}`);
  if (dev?.score != null && dev.score >= PROVEN_DEV) edges.push(`proven dev (score ${dev.score})`);
  // Buy flow only counts when the trading looks genuine (no wash, bots or one dominant wallet).
  const trading = gate.find((g) => g.key === "trading");
  const genuine = !trading || trading.status === "pass" || trading.status === "unknown";
  if (genuine && share !== null && share >= STRONG_BUY_SHARE && total >= STRONG_FLOW_TRADES) edges.push(`buyers in control (${Math.round(share * 100)}% of ${total} trades)`);

  const timing = timingOf(input.change);
  const fails = gate.filter((g) => g.status === "fail");
  const warns = gate.filter((g) => g.status === "warn");
  const unknowns = gate.filter((g) => g.status === "unknown" && !SOFT_UNKNOWN.has(g.key));
  const contract = gate.find((g) => g.key === "contract")!;
  const timingOk = timing === "early" || timing === "mid-move";
  const clean = contract.status === "pass" && warns.length <= 1 && unknowns.length === 0;

  let verdict: Verdict;
  if (fails.length) verdict = "avoid";
  else if (clean && timingOk && edges.length > 0) verdict = h ? "tradeable" : "candidate";
  else verdict = "watch";

  const timingNote =
    timing === "overextended" ? "vertical move — don't chase, wait for a pullback"
    : timing === "dumping" ? "price is dumping — wait for it to stabilise"
    : timing === "mid-move" ? "already moving — size down"
    : null;
  const why = (g: GateItem) => `${g.label}: ${g.detail}`;
  const watchReason =
    contract.status !== "pass" ? why(contract)
    : unknowns[0] ? why(unknowns[0])
    : !timingOk && timingNote ? `Timing: ${timingNote}`
    : warns.length > 1 ? `${warns.length} warnings — ${warns.map((g) => g.label.toLowerCase()).join(", ")}`
    : edges.length === 0 && !genuine && share !== null && share >= STRONG_BUY_SHARE ? "safety checks are clean, but the buy pressure is bot-inflated and there is no other reason to buy"
    : edges.length === 0 ? "safety checks are clean, but no reason to buy yet (no smart wallets, unproven dev, no buy pressure)"
    : "not every condition is met";

  const headline =
    verdict === "avoid" ? `Avoid — ${why(fails[0])}`
    : verdict === "tradeable" ? `Tradeable — clean checks, ${edges.join(", ")}`
    : verdict === "candidate" ? `Candidate — clean pre-checks, ${edges.join(", ")}; holder check still needed`
    : `Watch — ${watchReason}`;

  const reasons: string[] = [
    ...fails.map(why),
    ...(timingNote ? [`Timing: ${timingNote}`] : []),
    ...warns.map(why),
    ...unknowns.map(why),
    ...(verdict === "avoid" ? [] : edges.map((e) => `Edge: ${e}`)),
  ].slice(0, 3);

  // Plan only from measured levels; never invented.
  const p = input.plan;
  const plan =
    p && p.entryLow !== null && p.stop !== null && p.stop > 0
      ? {
          entryLow: p.entryLow,
          entryHigh: p.entryHigh ?? p.entryLow,
          stop: p.stop,
          target: p.target,
          stopDistancePct: ((((p.entryHigh ?? p.entryLow) + p.entryLow) / 2 - p.stop) / (((p.entryHigh ?? p.entryLow) + p.entryLow) / 2)) * 100,
        }
      : null;

  const RANK: Record<GateStatus, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };
  const sections: Section[] = QUESTIONS.map((q) => {
    const items = gate.filter((g) => (q.gates as readonly string[]).includes(g.key));
    // A part that could not run lowers the score but does not hide what the other checks for the question found.
    const known = items.filter((g) => g.status !== "unknown");
    const status = known.length ? known.reduce<GateStatus>((w, g) => (RANK[g.status] > RANK[w] ? g.status : w), "pass") : "unknown";
    let score = items.length ? 100 - 30 * items.filter((g) => g.status === "warn").length - 10 * items.filter((g) => g.status === "unknown").length : 50;
    if (items.some((g) => g.status === "fail")) score = Math.min(score, 15);
    return { key: q.key, question: q.question, status, score: Math.max(0, Math.min(100, score)), items };
  });
  const avg = Math.round(sections.reduce((sum, x) => sum + x.score, 0) / sections.length);
  const safetyScore = fails.length ? Math.min(avg, 25) : avg;

  const next: string[] =
    verdict === "avoid" || verdict === "tradeable" ? []
    : [
        ...(contract.status === "unknown" ? ["The contract check to complete"] : []),
        ...(timing === "overextended" ? ["A pullback or a calmer 5-minute candle (it is in a vertical move)"] : []),
        ...(timing === "dumping" ? ["The price to stop falling and hold a level"] : []),
        ...(warns.length > 1 ? [`Fewer warnings (${warns.map((g) => g.label.toLowerCase()).join(", ")})`] : []),
        ...(edges.length === 0 ? ["A reason to buy: smart wallets buying, a proven dev, or strong genuine buy flow"] : []),
        ...(verdict === "candidate" ? ["The holder check (open the coin's page)"] : []),
      ];

  for (const g of gate) g.basis = g.status === "unknown" ? "unavailable" : INFERRED.has(g.key) ? "inferred" : "confirmed";
  const risk: RiskLevel =
    fails.some((g) => TRAP.has(g.key)) ? "critical"
    : fails.length || warns.length >= 3 || timing === "dumping" ? "high"
    : warns.length || contract.status !== "pass" || !h || unknowns.length || (inv !== null && inv.sell.status !== "ok") ? "moderate"
    : "low";
  const order = (g: GateItem) => (g.status === "fail" ? (TRAP.has(g.key) ? 0 : 1) : g.status === "warn" ? 2 : g.status === "unknown" ? 3 : 4);
  const findings = [...gate].sort((a, b) => order(a) - order(b)).filter((g) => g.status !== "unknown" || g.key === "contract" || g.key === "sell").slice(0, 3);

  return { verdict, headline, reasons, edges, gate, timing, exit: { tradeSizeUsd, slippagePct: slip }, plan, fullCheck: Boolean(h), sections, safetyScore, next, risk, findings };
}

/** Position size so that hitting the stop loses `riskUsd`. */
export function positionSizeUsd(riskUsd: number, stopDistancePct: number): number | null {
  if (stopDistancePct <= 0) return null;
  return riskUsd / (stopDistancePct / 100);
}

/** Preferred item to quote when a whole section passed (the most telling one). */
const LEAD: Record<Section["key"], GateItem["key"][]> = {
  sell: ["sell", "exit", "transfer"],
  liquidity: ["pool", "liquidity"],
  control: ["contract", "devrecord", "dev"],
  insiders: ["insiders", "concentration", "snipers"],
  trading: ["trading", "flow"],
};

/** One line answering a section's question: its worst finding, or its most telling pass. */
export function sectionSummary(s: Section): string {
  const worst = s.items.find((g) => g.status === "fail") ?? s.items.find((g) => g.status === "warn");
  if (worst) return worst.detail;
  const lead = LEAD[s.key].map((k) => s.items.find((g) => g.key === k && g.status === "pass")).find(Boolean);
  return (lead ?? s.items[0])?.detail ?? "Not checked";
}
