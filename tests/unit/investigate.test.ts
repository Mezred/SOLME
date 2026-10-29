import { describe, expect, it } from "vitest";
import { decide, sectionSummary, type DecisionInput } from "@/lib/decision/verdict";
import type { RawTx } from "@/lib/providers/helius-history";
import { analyseTrades, groupHolders, impliedTaxPct, sellFailure, type Investigation } from "@/lib/tokens/investigate";

const MINT = "Mint111111111111111111111111111111111111pump";

describe("sell simulation helpers", () => {
  it("measures a hidden tax from simulated proceeds vs the quote", () => {
    expect(impliedTaxPct(5_000_000_000, 5_000_000_000)).toBe(0);
    expect(impliedTaxPct(5_000_000_000, 4_000_000_000)).toBe(20);
    expect(impliedTaxPct(5_000_000_000, -1)).toBe(100);
  });

  it("explains why a sell reverts, and ignores a payer that cannot pay fees", () => {
    expect(sellFailure({ InstructionError: [2, { Custom: 17 }] }, ["Program log: Error: Account is frozen"])).toMatch(/frozen/);
    expect(sellFailure("x", ["Program log: TransferHook rejected"])).toMatch(/transfer hook/);
    expect(sellFailure({ InstructionError: [3, { Custom: 6001 }] }, ["Program log: Error: SlippageToleranceExceeded"])).toMatch(/hidden tax or trap/);
    expect(sellFailure("InsufficientFundsForFee", [])).toBeNull();
  });
});

describe("connected holders", () => {
  const origin = new Map([
    ["A", { funder: "DEV", firstAt: 0 }],
    ["B", { funder: "F1", firstAt: 0 }],
    ["C", { funder: "F1", firstAt: 0 }],
    ["D", { funder: "BINANCE", firstAt: 0 }],
    ["E", { funder: "BINANCE", firstAt: 0 }],
    ["F", { funder: "DEVFUNDER", firstAt: 1_000_000 - 3600 }],
  ]);
  const holders = [
    { owner: "A", pct: 6 },
    { owner: "B", pct: 5 },
    { owner: "C", pct: 4 },
    { owner: "D", pct: 3 },
    { owner: "E", pct: 3 },
    { owner: "F", pct: 2 },
  ];

  it("links wallets funded by the dev or the dev's funder, and groups shared funders (not exchanges)", () => {
    const r = groupHolders(holders, origin, { address: "DEV", funder: "DEVFUNDER" }, (a) => a === "BINANCE", 1_000_000);
    expect(r.devLinked).toEqual({ wallets: 2, pct: 8 });
    expect(r.clusters).toEqual([{ funder: "F1", wallets: 2, pct: 9 }]);
    expect(r.newWallets).toEqual({ wallets: 1, pct: 2 });
  });
});

describe("trading patterns", () => {
  const POOL = "Pool1111111111111111111111111111111111111";
  const W = (n: number) => `Wallet${n}`.padEnd(44, "1");
  let slot = 0;
  // One swap: `owner` gains (buy) or loses (sell) `tokens` of the coin against the pool; `payer` signs and pays fees.
  const swap = (owner: string, side: "buy" | "sell", tokens: number, payer = owner): RawTx => {
    const raw = tokens * 1e6;
    const bal = (o: string, pre: number, post: number) => [
      { accountIndex: 2, mint: MINT, owner: o, uiTokenAmount: { amount: String(pre), decimals: 6 } },
      { accountIndex: 2, mint: MINT, owner: o, uiTokenAmount: { amount: String(post), decimals: 6 } },
    ];
    const [tPre, tPost] = side === "buy" ? bal(owner, 0, raw) : bal(owner, raw, 0);
    const [pPre, pPost] = side === "buy" ? bal(POOL, 1e15, 1e15 - raw) : bal(POOL, 1e15, 1e15 + raw);
    return {
      slot: ++slot,
      blockTime: 1_790_000_000 + slot * 10,
      transaction: { signatures: [`s${slot}`], message: { accountKeys: [{ pubkey: payer, signer: true }, { pubkey: POOL }] } },
      meta: { err: null, fee: 5000, preBalances: [1e9, 0], postBalances: [1e9, 0], preTokenBalances: [tPre, pPre], postTokenBalances: [tPost, pPost] },
    };
  };

  it("finds wallets buying and selling straight back, and their share of volume", () => {
    const txs = [
      ...[1, 2, 3].flatMap(() => [swap(W(1), "buy", 100), swap(W(1), "sell", 100)]), // in circles: 600 tokens
      swap(W(2), "buy", 200),
      swap(W(3), "buy", 200),
    ];
    const r = analyseTrades(txs, MINT, POOL, 1); // $1 per token
    expect(r.trades).toBe(8);
    expect(r.traders).toBe(3);
    expect(Math.round(r.washPct)).toBe(60);
    expect(r.dustPct).toBe(0);
  });

  it("sees volume bots that trade from one wallet and pay fees from another, at dust size", () => {
    // As seen live: a throwaway payer signs, the tokens move in another wallet, worth cents.
    const txs = Array.from({ length: 12 }, (_, i) => swap(W(20 + (i % 3)), i % 2 ? "sell" : "buy", 0.01, W(90 + i)));
    const r = analyseTrades(txs, MINT, POOL, 1);
    expect(r.trades).toBe(12);
    expect(r.dustPct).toBe(100);
    expect(r.traders).toBe(3); // payers are not traders
  });
});

describe("the verdict with the investigation", () => {
  const ok: Investigation = {
    version: 1,
    computedAt: "",
    sell: { status: "ok", amountUsd: 500, receivedUsd: 487, impactPct: 2.6, taxPct: 0.1, route: "Pump.fun Amm", reason: null },
    insiders: { status: "ok", checked: 15, devLinked: { wallets: 0, pct: 0 }, clusters: [], newWallets: { wallets: 1, pct: 2 } },
    pool: { status: "ok", pools: 1, quoteSymbol: "SOL", quoteAmount: 210, realQuote: true, dropPct: 5, ageHours: 3 },
    trading: { status: "ok", trades: 100, traders: 70, spanMinutes: 12, washPct: 4, topWalletPct: 8, dustPct: 10 },
  };
  const base: DecisionInput = {
    priceUsd: 0.001, change: { m5: 2, h1: 30, h6: 80, h24: 200 }, liquidityUsd: 60_000, marketCapUsd: 500_000, ageHours: 3,
    buysH1: 450, sellsH1: 250, security: { riskLevel: "low", failedChecks: [], warnings: [] },
    holders: { top10WalletPct: 18, devPct: 1, bundlePct: 2, launchBuyersHoldPct: 3 },
    smartWallets: { wallets: 2, sol: 6 },
  };
  const with_ = (inv: Partial<Investigation>) => decide({ ...base, investigation: { ...ok, ...inv } });

  it("answers all five questions and is tradeable when everything is clean", () => {
    const d = with_({});
    expect(d.verdict).toBe("tradeable");
    expect(d.sections.map((s) => [s.key, s.status])).toEqual([["sell", "pass"], ["liquidity", "pass"], ["control", "pass"], ["insiders", "pass"], ["trading", "pass"]]);
    expect(sectionSummary(d.sections[0])).toBe("Simulated selling $500 → $487 received, no hidden tax");
    expect(sectionSummary(d.sections[1])).toBe("210 SOL real in the pool · none pulled");
    expect(d.gate.find((g) => g.key === "exit")?.detail).toBe("Selling $500 moves price ~2.6% (real route)");
    expect(d.safetyScore).toBe(100);
  });

  it("a failed or taxed sell is a trap: avoid", () => {
    expect(with_({ sell: { ...ok.sell, status: "fails", reason: "the token account is frozen" } }).headline).toBe("Avoid — Sell test: Simulated sell fails: the token account is frozen");
    expect(with_({ sell: { ...ok.sell, taxPct: 25 } }).verdict).toBe("avoid");
    expect(with_({ sell: { ...ok.sell, taxPct: 5 } }).gate.find((g) => g.key === "sell")?.status).toBe("warn");
  });

  it("pulled liquidity and dev-linked or clustered supply each fail; fake volume is only a warning", () => {
    expect(with_({ pool: { ...ok.pool, dropPct: 70 } }).verdict).toBe("avoid");
    expect(with_({ insiders: { ...ok.insiders, devLinked: { wallets: 3, pct: 14 } } }).headline).toMatch(/linked to the dev hold 14%/);
    expect(with_({ insiders: { ...ok.insiders, clusters: [{ funder: "F", wallets: 4, pct: 22 }] } }).verdict).toBe("avoid");
    expect(with_({ trading: { ...ok.trading, washPct: 55 } }).gate.find((g) => g.key === "trading")?.status).toBe("warn");
    expect(with_({ trading: { ...ok.trading, washPct: 55 } }).verdict).not.toBe("avoid");
  });

  it("fake activity cancels buy flow as a reason to buy", () => {
    const d = decide({ ...base, smartWallets: { wallets: 0, sol: 0 }, investigation: { ...ok, trading: { ...ok.trading, dustPct: 70 } } });
    expect(d.edges).toEqual([]);
    expect(d.verdict).toBe("watch");
    expect(d.next).toContain("A reason to buy: smart wallets buying, a proven dev, or strong genuine buy flow");
  });

  it("parts that could not run are shown but never block", () => {
    const d = with_({ sell: { ...ok.sell, status: "unavailable", reason: "No holder wallet could be used for the simulation" }, trading: { ...ok.trading, status: "unavailable" } });
    expect(d.verdict).toBe("tradeable");
    expect(d.sections.find((s) => s.key === "trading")?.status).toBe("pass"); // order flow still answers it
    expect(d.gate.find((g) => g.key === "sell")?.status).toBe("unknown");
  });

  it("caps the safety score when anything failed", () => {
    expect(with_({ pool: { ...ok.pool, dropPct: 80 } }).safetyScore).toBeLessThanOrEqual(25);
  });
});
