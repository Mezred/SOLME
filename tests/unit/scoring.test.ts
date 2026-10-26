import { describe, expect, it } from "vitest";
import { scoreToken, tradeScenario, type ScoringInput } from "@/lib/scoring/engine";
import type { ScoringSettings } from "@/lib/settings";
import type { Candle, SecurityCheck } from "@/lib/providers/types";

const settings: ScoringSettings = {
  version: "v1",
  weights: {
    price_momentum: 0.13, volume_acceleration: 0.12, buy_sell_imbalance: 0.12, liquidity_quality: 0.14,
    liquidity_to_mcap: 0.06, holder_distribution: 0.1, token_age: 0.06, trading_activity: 0.08,
    smart_money: 0.08, market_regime: 0.05, volatility: 0.06,
  },
  security_penalty: { critical: 100, high: 25, medium: 10, unknown: 5 },
  thresholds: {
    min_liquidity_usd: 25000, min_volume_h24_usd: 10000, signal_min_score: 60, signal_min_confidence: 45,
    dedup_hours: 6, rescore_delta: 10, stale_after_minutes: 15, signal_ttl_hours: 24,
  },
};

const now = new Date("2026-10-26T12:00:00Z");
const passing: SecurityCheck[] = [
  { key: "mint_authority", label: "Mint authority", result: "pass", detail: "revoked" },
  { key: "freeze_authority", label: "Freeze authority", result: "pass", detail: "revoked" },
];

function input(overrides: Partial<ScoringInput["market"]> = {}, rest: Partial<ScoringInput> = {}): ScoringInput {
  return {
    now,
    capturedAt: new Date(now.getTime() - 60_000),
    market: {
      priceUsd: 1,
      priceChange: { m5: 0.5, h1: 6, h6: 12, h24: 25, d7: null },
      volume: { m5: 20_000, h1: 200_000, h6: 700_000, h24: 1_800_000 },
      liquidityUsd: 600_000,
      marketCap: 6_000_000,
      fdv: 6_000_000,
      txns: { h1: { buys: 700, sells: 300 }, h24: { buys: 9000, sells: 6000 } },
      pairCreatedAt: new Date(now.getTime() - 20 * 86_400_000),
      promoted: false,
      ...overrides,
    },
    security: { status: "complete", riskLevel: "low", checks: passing, checkedAt: now },
    holders: { count: 12000, top10Pct: 18 },
    smartMoney: null,
    regime: { nativeChangeH24: 2 },
    candles: null,
    ...rest,
  };
}

describe("scoreToken", () => {
  it("classifies confirmed momentum and keeps scores in range", () => {
    const r = scoreToken(input(), settings);
    expect(r.signalType).toBe("momentum");
    expect(r.eligibility.eligible).toBe(true);
    for (const s of [r.aiScore, r.riskScore, r.confidenceScore, r.qualityScore!, r.momentumScore!]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("does not emit a bullish signal when price rises without buy pressure", () => {
    const r = scoreToken(input({ txns: { h1: { buys: 450, sells: 550 }, h24: { buys: 7000, sells: 8000 } } }), settings);
    expect(r.signalType).not.toBe("momentum");
    expect(r.signalType).not.toBe("accumulation");
  });

  it("caps the score and flags high risk on a critical security failure", () => {
    const r = scoreToken(input({}, {
      security: { status: "complete", riskLevel: "critical", checkedAt: now, checks: [{ key: "honeypot", label: "Honeypot simulation", result: "fail", detail: "cannot sell" }] },
    }), settings);
    expect(r.aiScore).toBeLessThanOrEqual(15);
    expect(r.signalType).toBe("high_risk");
    expect(r.strength).toBe("avoid");
    expect(r.riskFlags.join(" ")).toMatch(/Honeypot/);
  });

  it("treats missing security data as unknown — never clean", () => {
    const r = scoreToken(input({}, { security: null }), settings);
    expect(r.riskFlags.some((f) => /not verified clean/.test(f))).toBe(true);
    const clean = scoreToken(input(), settings);
    expect(r.confidenceScore).toBeLessThan(clean.confidenceScore);
    expect(r.aiScore).toBeLessThan(clean.aiScore);
  });

  it("excludes missing factors instead of imputing them and lists them", () => {
    const r = scoreToken(input({}, { holders: null }), settings);
    const holder = r.factors.find((f) => f.key === "holder_distribution")!;
    expect(holder.missing).toBe(true);
    expect(holder.score).toBeNull();
    expect(r.missingData).toContain("holder_distribution");
    expect(r.missingData).toContain("smart_money");
    expect(r.missingData).toContain("price_change_7d");
  });

  it("refuses to publish below minimum liquidity", () => {
    const r = scoreToken(input({ liquidityUsd: 8_000 }), settings);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.eligibility.reasons).toContain("Below minimum liquidity");
  });

  it("marks stale data and halves confidence", () => {
    const fresh = scoreToken(input(), settings);
    const stale = scoreToken(input({}, { capturedAt: new Date(now.getTime() - 60 * 60_000) }), settings);
    expect(stale.stale).toBe(true);
    expect(stale.eligibility.eligible).toBe(false);
    expect(stale.confidenceScore).toBeLessThanOrEqual(Math.ceil(fresh.confidenceScore / 2));
  });

  it("caps parabolic moves as overextended", () => {
    const r = scoreToken(input({ priceChange: { m5: 5, h1: 40, h6: 150, h24: 900, d7: null } }), settings);
    const pm = r.factors.find((f) => f.key === "price_momentum")!;
    expect(pm.score).toBeLessThanOrEqual(60);
    expect(r.riskFlags.some((f) => /Overextended/.test(f))).toBe(true);
  });

  it("detects accumulation: buy pressure without price expansion", () => {
    const r = scoreToken(input({ priceChange: { m5: 0.1, h1: 1, h6: 2, h24: 3, d7: null }, volume: { m5: 9000, h1: 90_000, h6: 400_000, h24: 1_400_000 } }), settings);
    expect(r.signalType).toBe("accumulation");
  });

  it("detects distribution and marks it avoid", () => {
    const r = scoreToken(input({ priceChange: { m5: -1, h1: -8, h6: -10, h24: -12, d7: null }, txns: { h1: { buys: 300, sells: 700 }, h24: { buys: 6000, sells: 9000 } } }), settings);
    expect(r.signalType).toBe("distribution");
    expect(r.strength).toBe("avoid");
  });

  it("flags paid promotion without rewarding it", () => {
    const base = scoreToken(input(), settings);
    const promoted = scoreToken(input({ promoted: true }), settings);
    expect(promoted.aiScore).toBe(base.aiScore);
    expect(promoted.riskFlags.some((f) => /promotion/i.test(f))).toBe(true);
  });
});

describe("tradeScenario", () => {
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => {
    const close = 1 + i * 0.01;
    return { time: i * 900, open: close - 0.005, high: close + 0.01, low: close - 0.01, close, volume: 1000 };
  });

  it("returns null without enough candles (never guesses levels)", () => {
    expect(tradeScenario(1.3, candles.slice(0, 10))).toBeNull();
    expect(tradeScenario(null, candles)).toBeNull();
  });

  it("orders levels: stop < invalidation < entry ≤ price < TP1 < TP2", () => {
    const s = tradeScenario(1.3, candles)!;
    expect(s.stopLoss).toBeLessThan(s.invalidation);
    expect(s.invalidation).toBeLessThan(s.entryLow);
    expect(s.entryLow).toBeLessThanOrEqual(s.entryHigh);
    expect(s.entryHigh).toBe(1.3);
    expect(s.takeProfits[0].price).toBeGreaterThan(1.3);
    expect(s.takeProfits[1].price).toBeGreaterThan(s.takeProfits[0].price);
  });
});
