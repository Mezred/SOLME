/**
 * DEMO MODE dataset (DEMO_MODE=true). Every row written here has is_demo = true, token names are
 * prefixed "[DEMO]" and the UI shows a persistent banner. Demo data is synthetic: it exercises the real
 * scoring engine and UI but never represents a real market. In live mode demo rows are filtered out.
 */
import type { ChainId } from "@/lib/chains";
import { queryOne, transaction } from "@/lib/db";
import { saveScore, storeMarketData, storeSecurity } from "@/lib/ingestion/pipeline";
import type { Candle, MarketPairData, SecurityCheck, SecurityReport } from "@/lib/providers/types";
import { scoreToken } from "@/lib/scoring/engine";
import { getSetting } from "@/lib/settings";

type Profile = "momentum" | "accumulation" | "distribution" | "honeypot" | "newborn" | "steady" | "breakout";

interface DemoToken {
  chain: ChainId;
  symbol: string;
  name: string;
  address: string;
  basePrice: number;
  liquidity: number;
  ageDays: number;
  profile: Profile;
}

const sol = (s: string) => `Demo${s}`.padEnd(43, "1");

export const DEMO_TOKENS: DemoToken[] = [
  { chain: "solana", symbol: "dAURA", name: "[DEMO] Aurora", address: sol("Aurora"), basePrice: 0.0421, liquidity: 840_000, ageDays: 21, profile: "momentum" },
  { chain: "solana", symbol: "dKITE", name: "[DEMO] Kite Protocol", address: sol("Kite"), basePrice: 1.82, liquidity: 2_400_000, ageDays: 140, profile: "accumulation" },
  { chain: "solana", symbol: "dZEPH", name: "[DEMO] Zephyr", address: sol("Zephyr"), basePrice: 0.00071, liquidity: 160_000, ageDays: 0.3, profile: "newborn" },
  { chain: "solana", symbol: "dRUGX", name: "[DEMO] Trap Token", address: sol("Trap"), basePrice: 0.0093, liquidity: 95_000, ageDays: 2, profile: "honeypot" },
];

/** Deterministic PRNG so demo values are stable within a time bucket. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const PROFILE: Record<Profile, { h1: number; h24: number; buyShare: number; volMult: number }> = {
  momentum: { h1: 7, h24: 28, buyShare: 0.66, volMult: 2.4 },
  accumulation: { h1: 0.8, h24: 2.5, buyShare: 0.64, volMult: 1.8 },
  distribution: { h1: -6, h24: -14, buyShare: 0.36, volMult: 2.1 },
  honeypot: { h1: 12, h24: 85, buyShare: 0.92, volMult: 3 },
  newborn: { h1: 35, h24: 140, buyShare: 0.6, volMult: 1.2 },
  steady: { h1: 0.4, h24: 1.2, buyShare: 0.52, volMult: 1 },
  breakout: { h1: 0.9, h24: -1.5, buyShare: 0.55, volMult: 3.2 },
};

export function demoMarket(t: DemoToken, now: Date): MarketPairData {
  const r = rng(hash(t.address) + Math.floor(now.getTime() / 120_000));
  const pf = PROFILE[t.profile];
  const jitter = (x: number, pct = 0.25) => x * (1 + (r() - 0.5) * 2 * pct);
  const h24 = jitter(pf.h24);
  const price = t.basePrice * (1 + h24 / 100) * jitter(1, 0.01);
  const volH24 = t.liquidity * jitter(1.6);
  const volH1 = (volH24 / 24) * jitter(pf.volMult, 0.15);
  const tx24 = Math.round(volH24 / jitter(450));
  const tx1 = Math.max(25, Math.round((tx24 / 24) * pf.volMult));
  const share = Math.min(0.97, Math.max(0.03, jitter(pf.buyShare, 0.04)));
  const mcap = t.liquidity * jitter(t.profile === "steady" ? 9 : 7);
  return {
    chain: t.chain,
    tokenAddress: t.address,
    symbol: t.symbol,
    name: t.name,
    logoUrl: null,
    pairAddress: `${t.address.slice(0, -4)}PAIR`.replace(/^0xde/, "0xdf"),
    dexId: "demo-dex",
    quoteSymbol: "SOL",
    quoteAddress: null,
    url: null,
    pairCreatedAt: new Date(now.getTime() - t.ageDays * 86_400_000),
    priceUsd: price,
    priceChange: { m5: jitter(pf.h1 / 6), h1: jitter(pf.h1), h6: jitter(pf.h24 / 2), h24, d7: null },
    volume: { m5: volH1 / 12, h1: volH1, h6: volH24 / 3, h24: volH24 },
    liquidityUsd: jitter(t.liquidity, 0.02),
    marketCap: mcap,
    fdv: mcap,
    txns: {
      m5: { buys: Math.round((tx1 / 12) * share), sells: Math.round((tx1 / 12) * (1 - share)) },
      h1: { buys: Math.round(tx1 * share), sells: Math.round(tx1 * (1 - share)) },
      h6: { buys: Math.round(tx24 * 0.3 * share), sells: Math.round(tx24 * 0.3 * (1 - share)) },
      h24: { buys: Math.round(tx24 * (share * 0.6 + 0.2)), sells: Math.round(tx24 * (1 - (share * 0.6 + 0.2))) },
    },
    websites: [],
    socials: [],
    promoted: false,
    source: "demo",
  };
}

export function demoSecurity(t: DemoToken): SecurityReport {
  const pass = (key: string, label: string): SecurityCheck => ({ key, label, result: "pass", detail: "Demo: passes" });
  const checks: SecurityCheck[] =
    t.chain === "solana"
      ? [pass("mint_authority", "Mint authority"), pass("freeze_authority", "Freeze authority"), pass("metadata_mutable", "Mutable metadata"),
         { key: "honeypot", label: "Honeypot simulation", result: "unavailable", detail: "Not provided for Solana" }]
      : [pass("honeypot", "Honeypot simulation"), pass("sell_tax", "Sell tax"), pass("contract_verified", "Contract source verified"), pass("ownership", "Ownership")];
  if (t.profile === "honeypot") {
    checks[0] = t.chain === "solana"
      ? { key: "freeze_authority", label: "Freeze authority", result: "fail", detail: "Demo: freeze authority active" }
      : { key: "honeypot", label: "Honeypot simulation", result: "fail", detail: "Demo: sell simulation failed" };
  }
  const top10 = t.profile === "newborn" ? 46 : t.profile === "honeypot" ? 71 : 14 + (hash(t.symbol) % 12);
  checks.push({ key: "top_holder_concentration", label: "Top-10 holder concentration", result: top10 > 50 ? "fail" : top10 > 30 ? "warn" : "pass", detail: `Demo: ${top10}%` });
  return {
    provider: "demo",
    checkedAt: new Date(),
    status: "partial",
    riskLevel: t.profile === "honeypot" ? "critical" : top10 > 30 ? "medium" : "low",
    checks,
    unavailable: checks.filter((c) => c.result === "unavailable").map((c) => c.key),
    limitations: "DEMO DATA — synthetic security report for demonstration only.",
    holderCount: 1200 + (hash(t.address) % 30000),
    top10HolderPct: top10,
    raw: null,
  };
}

/** Synthetic candles ending at the current demo price. Only ever served for is_demo tokens. */
export function demoCandles(address: string, price: number, count = 96, stepSec = 900): Candle[] {
  const r = rng(hash(address));
  const t = DEMO_TOKENS.find((x) => x.address === address);
  const drift = t ? PROFILE[t.profile].h24 / 100 / count : 0;
  const closes: number[] = [price];
  for (let i = 1; i < count; i++) closes.unshift(closes[0] / (1 + drift + (r() - 0.5) * 0.03));
  const now = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
  return closes.map((close, i) => {
    const open = i === 0 ? close * 0.995 : closes[i - 1];
    const hi = Math.max(open, close) * (1 + r() * 0.01);
    const lo = Math.min(open, close) * (1 - r() * 0.01);
    return { time: now - (count - 1 - i) * stepSec, open, high: hi, low: lo, close, volume: 1000 + r() * 9000 };
  });
}

let lastRun = 0;

/** Refreshes demo snapshots and scores at most every 2 minutes. */
export async function ensureDemoData(force = false) {
  if (!force && Date.now() - lastRun < 110_000) return;
  lastRun = Date.now();
  const scoring = await getSetting("scoring");
  const now = new Date();
  for (const t of DEMO_TOKENS) {
    const m = demoMarket(t, now);
    const sec = demoSecurity(t);
    const ids = await transaction((tx) => storeMarketData(tx, m, null, { isDemo: true, discoveryReason: "demo", holderCount: sec.holderCount }));
    const last = await queryOne<{ checked_at: Date }>("SELECT checked_at FROM token_security_checks WHERE token_id = $1 ORDER BY checked_at DESC LIMIT 1", [ids.tokenId]);
    if (!last) await storeSecurity(ids.tokenId, sec, true);
    const result = scoreToken(
      {
        now,
        capturedAt: now,
        market: m,
        security: sec,
        holders: { count: sec.holderCount, top10Pct: sec.top10HolderPct },
        smartMoney: null,
        regime: { nativeChangeH24: 1.4 },
        candles: demoCandles(t.address, m.priceUsd!),
      },
      scoring,
    );
    await saveScore(ids.tokenId, result, now);
  }
}
