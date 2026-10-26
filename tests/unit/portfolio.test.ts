import { describe, expect, it } from "vitest";
import { computePosition, summarizePortfolio, toCsv, type TradeInput } from "@/lib/portfolio/calc";

const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const buy = (q: number, p: number, fee = 0, day = 1): TradeInput => ({ side: "buy", quantity: q, price: p, fee, executedAt: d(day) });
const sell = (q: number, p: number, fee = 0, day = 2): TradeInput => ({ side: "sell", quantity: q, price: p, fee, executedAt: d(day) });

describe("computePosition", () => {
  it("includes buy fees in cost basis", () => {
    const m = computePosition([buy(100, 1, 2)], 1.5);
    expect(m.avgCost).toBeCloseTo(1.02);
    expect(m.totalInvested).toBeCloseTo(102);
    expect(m.unrealizedPnl).toBeCloseTo(48);
    expect(m.returnPct).toBeCloseTo((48 / 102) * 100);
  });

  it("realizes P&L on partial exits using average cost and sell fees", () => {
    const m = computePosition([buy(100, 1, 0, 1), buy(100, 2, 0, 2), sell(50, 3, 1, 3)], 2);
    // avg cost 1.5 → realized = 50*3 - 1 - 50*1.5 = 74
    expect(m.realizedPnl).toBeCloseTo(74);
    expect(m.openQuantity).toBe(150);
    expect(m.avgCost).toBeCloseTo(1.5);
    expect(m.unrealizedPnl).toBeCloseTo(75);
    expect(m.closed).toBe(false);
  });

  it("closes the position when fully sold", () => {
    const m = computePosition([buy(10, 5, 0.5), sell(4, 6, 0.1, 2), sell(6, 4, 0.1, 3)], null);
    expect(m.closed).toBe(true);
    expect(m.openQuantity).toBe(0);
    expect(m.unrealizedPnl).toBe(0);
    // cost 50.5, avg 5.05; realized = (24-0.1-20.2) + (24-0.1-30.3) = 3.7 + -6.4 = -2.7
    expect(m.realizedPnl).toBeCloseTo(-2.7);
    expect(m.totalFees).toBeCloseTo(0.7);
  });

  it("returns null unrealized P&L when price is missing for an open position", () => {
    const m = computePosition([buy(10, 1)], null);
    expect(m.unrealizedPnl).toBeNull();
    expect(m.returnPct).toBeNull();
    expect(m.marketValue).toBeNull();
  });

  it("detects oversells", () => {
    const m = computePosition([buy(1, 1), sell(2, 1)], 1);
    expect(m.error).toMatch(/exceeds/);
  });

  it("orders trades by execution time regardless of input order", () => {
    const m = computePosition([sell(5, 2, 0, 5), buy(10, 1, 0, 1)], 1);
    expect(m.error).toBeNull();
    expect(m.realizedPnl).toBeCloseTo(5);
  });
});

describe("summarizePortfolio", () => {
  it("withholds win rate and drawdown until there is enough history", () => {
    const s = summarizePortfolio([computePosition([buy(1, 1), sell(1, 2)], null)]);
    expect(s.winRate).toBeNull();
    expect(s.maxDrawdownUsd).toBeNull();
    expect(s.realizedPnl).toBeCloseTo(1);
  });

  it("computes win rate and max drawdown from the realized equity curve", () => {
    const ps = [
      computePosition([buy(1, 10, 0, 1), sell(1, 20, 0, 2)], null), // +10
      computePosition([buy(1, 10, 0, 3), sell(1, 4, 0, 4)], null), // -6
      computePosition([buy(1, 10, 0, 5), sell(1, 8, 0, 6)], null), // -2
      computePosition([buy(1, 10, 0, 7), sell(1, 15, 0, 8)], null), // +5
    ];
    const s = summarizePortfolio(ps);
    expect(s.winRate).toBe(50);
    expect(s.maxDrawdownUsd).toBeCloseTo(8);
    expect(s.equityCurve.map((p) => p.cumulativePnl)).toEqual([10, 4, 2, 7]);
  });

  it("marks total unrealized as unknown when any open position lacks a price", () => {
    const s = summarizePortfolio([computePosition([buy(1, 1)], 2), computePosition([buy(1, 1)], null)]);
    expect(s.unrealizedPnl).toBeNull();
    expect(s.positionsMissingPrice).toBe(1);
  });
});

describe("toCsv", () => {
  it("escapes quotes and neutralizes formula injection", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(1)", 'say "hi"']]);
    expect(csv).toBe(`a,b\n'=HYPERLINK(1),"say ""hi"""`);
  });
});
