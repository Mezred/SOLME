import { describe, expect, it } from "vitest";
import { decide, estimateSlippagePct, positionSizeUsd, timingOf, type DecisionInput } from "@/lib/decision/verdict";

// A typical healthy memecoin: $60k pool, $600k market cap, 3h old, up 35% this hour, buyers in control.
const base: DecisionInput = {
  priceUsd: 0.0006,
  change: { m5: 3, h1: 35, h6: 120, h24: 400 },
  liquidityUsd: 60_000,
  marketCapUsd: 600_000,
  ageHours: 3,
  buysH1: 420,
  sellsH1: 280,
  security: { riskLevel: "low", failedChecks: [] },
  smartWallets: { wallets: 0, sol: 0 },
};
const cleanHolders = { top10WalletPct: 18, devPct: 1, bundlePct: 2, launchBuyersHoldPct: 4, sniperPct: 6, devBuyPct: 3 };
const full = (o: Partial<DecisionInput> = {}) => decide({ ...base, holders: cleanHolders, ...o });

describe("decide (memecoin rules)", () => {
  it("is tradeable with clean checks and a reason to buy, no score or pattern needed", () => {
    const d = full({ smartWallets: { wallets: 2, sol: 8.5 } });
    expect(d.verdict).toBe("tradeable");
    expect(d.edges).toContain("2 smart wallets bought (8.5 SOL)");
    expect(d.headline).toMatch(/^Tradeable — clean checks, 2 smart wallets bought/);
  });

  it("counts a proven dev and strong buy flow as reasons to buy", () => {
    expect(full({ dev: { launches: 8, migrated: 4, score: 72 } }).verdict).toBe("tradeable");
    expect(full({ buysH1: 450, sellsH1: 250 }).edges).toEqual(["buyers in control (64% of 700 trades)"]);
    expect(full({ buysH1: 70, sellsH1: 20 }).edges).toEqual([]); // too few trades to count as an edge
  });

  it("is watch when every check is clean but there is no reason to buy", () => {
    const d = full({ buysH1: 350, sellsH1: 350 });
    expect(d.verdict).toBe("watch");
    expect(d.headline).toMatch(/no reason to buy yet/);
  });

  it("is at most a candidate without the holder check", () => {
    expect(decide({ ...base, smartWallets: { wallets: 1, sol: 2 } }).verdict).toBe("candidate");
  });

  it("any failed safety item means avoid, with it in the headline", () => {
    expect(full({ security: { riskLevel: "high", failedChecks: ["Mint authority: enabled"] } }).headline).toBe("Avoid — Contract: Mint authority: enabled");
    expect(full({ liquidityUsd: 3_000 }).verdict).toBe("avoid");
    expect(full({ holders: { ...cleanHolders, top10WalletPct: 50 } }).verdict).toBe("avoid");
    expect(full({ holders: { ...cleanHolders, devPct: 15 } }).verdict).toBe("avoid");
    expect(full({ holders: { ...cleanHolders, bundlePct: 25, launchBuyersHoldPct: 8 } }).verdict).toBe("avoid");
    expect(full({ holders: { ...cleanHolders, launchBuyersHoldPct: 30 } }).verdict).toBe("avoid");
    expect(full({ dev: { launches: 14, migrated: 0, score: 5 } }).verdict).toBe("avoid");
  });

  it("a bundle that already sold out is a warning, not an avoid", () => {
    const b = full({ holders: { ...cleanHolders, bundlePct: 41, launchBuyersHoldPct: 0 } }).gate.find((g) => g.key === "bundle")!;
    expect(b.status).toBe("warn");
    expect(b.detail).toMatch(/already sold/);
  });

  it("judges holder concentration once, in the holder check, not again as a contract finding", () => {
    const conc = { riskLevel: "medium", failedChecks: [], warnings: ["Top-10 holder concentration: Top 10 non-pool holders own 37.5%"] };
    expect(full({ security: conc }).gate[0].status).toBe("pass");
    expect(decide({ ...base, security: conc }).gate[0].status).toBe("warn"); // no holder check: keep the provider's finding
    expect(full({ security: { riskLevel: "high", failedChecks: ["Top-10 holder concentration: 60%"], warnings: [] } }).gate[0].status).toBe("pass");
    expect(full({ security: { riskLevel: "critical", failedChecks: [], warnings: [] } }).gate[0].status).toBe("fail"); // unnamed critical
  });

  it("splits contract findings into who controls it and what can stop a sale, naming them", () => {
    const d = full({ security: { riskLevel: "high", failedChecks: [], warnings: ["Transfer fee: 2%", "Mutable metadata", "Upgradeable"] } });
    expect(d.gate.find((g) => g.key === "contract")).toMatchObject({ status: "warn", detail: "Mutable metadata; Upgradeable" });
    expect(d.gate.find((g) => g.key === "transfer")).toMatchObject({ status: "warn", detail: "Transfer fee: 2%" });
    const frozen = full({ security: { riskLevel: "critical", failedChecks: ["Freeze authority: active"], warnings: [] } });
    expect(frozen.gate.find((g) => g.key === "transfer")?.status).toBe("fail");
    expect(frozen.sections.find((s) => s.key === "sell")?.status).toBe("fail");
    expect(frozen.verdict).toBe("avoid");
  });

  it("a dev selling a fresh coin is a fail; on an older coin a warning", () => {
    expect(full({ ageHours: 0.5, devSoldPct: 3 }).gate.find((g) => g.key === "devsold")?.status).toBe("fail");
    expect(full({ ageHours: 30, devSoldPct: 3 }).gate.find((g) => g.key === "devsold")?.status).toBe("warn");
    expect(full({ devSoldPct: 0.4 }).gate.find((g) => g.key === "devsold")).toBeUndefined();
  });

  it("allows one warning but not two", () => {
    const sw = { wallets: 1, sol: 3 };
    expect(full({ smartWallets: sw, liquidityUsd: 12_000, marketCapUsd: 100_000 }).verdict).toBe("watch"); // thin pool + costly exit
    expect(full({ smartWallets: sw, holders: { ...cleanHolders, devPct: 7 } }).verdict).toBe("tradeable");
    expect(full({ smartWallets: sw, holders: { ...cleanHolders, devPct: 7, top10WalletPct: 35 } }).verdict).toBe("watch");
  });

  it("does not chase vertical moves or catch dumps", () => {
    const sw = { wallets: 3, sol: 20 };
    expect(full({ smartWallets: sw, change: { m5: 55, h1: 80, h6: 150, h24: 300 } }).verdict).toBe("watch");
    expect(full({ smartWallets: sw, change: { m5: -30, h1: -20, h6: 10, h24: 50 } }).headline).toMatch(/dumping/);
    expect(full({ smartWallets: sw, change: { m5: 22, h1: 60, h6: 90, h24: 120 } }).verdict).toBe("tradeable"); // mid-move is allowed
  });

  it("a bonding-curve coin needs no pool, and an unverified contract always blocks", () => {
    const curve = full({ smartWallets: { wallets: 1, sol: 1 }, liquidityUsd: null, onBondingCurve: true });
    expect(curve.gate.find((g) => g.key === "liquidity")?.status).toBe("pass");
    expect(curve.verdict).toBe("tradeable");
    expect(full({ smartWallets: { wallets: 1, sol: 1 }, security: null }).headline).toMatch(/^Watch — Contract: Not verified/);
  });

  it("warns when market cap dwarfs the pool", () => {
    expect(full({ marketCapUsd: 3_000_000 }).gate.find((g) => g.key === "liquidity")?.detail).toMatch(/50× the pool/);
  });

  it("first-time devs and quiet order flow are caveats, not blockers", () => {
    const d = full({ dev: { launches: 1, migrated: 0, score: null }, smartWallets: { wallets: 1, sol: 1 }, buysH1: 5, sellsH1: 4 });
    expect(d.verdict).toBe("tradeable");
  });

  it("never invents a trade plan", () => {
    expect(full().plan).toBeNull();
  });
});

describe("helpers", () => {
  it("estimates exit slippage on a constant-product pool", () => {
    expect(estimateSlippagePct(500, 100_000)).toBeCloseTo(0.99, 1);
    expect(estimateSlippagePct(500, null)).toBeNull();
  });
  it("classifies memecoin timing", () => {
    expect(timingOf({ m5: 2, h1: 40, h6: 150, h24: 600 })).toBe("early");
    expect(timingOf({ m5: 25, h1: 40, h6: 80, h24: 80 })).toBe("mid-move");
    expect(timingOf({ m5: 5, h1: 350, h6: 400, h24: 450 })).toBe("overextended");
    expect(timingOf({ m5: -5, h1: -45, h6: 0, h24: 0 })).toBe("dumping");
    expect(timingOf({ h1: null, h6: null, h24: null })).toBe("unknown");
  });
  it("sizes a position from risk and stop distance", () => {
    expect(positionSizeUsd(10, 20)).toBe(50);
  });
});

describe("passesScamCheck (alerts)", () => {
  it("passes when nothing failed and the contract was verified, even with late timing or no edge", async () => {
    const { passesScamCheck } = await import("@/lib/decision/check-token");
    expect(passesScamCheck(full())).toBe(true);
    expect(passesScamCheck(full({ change: { m5: 60, h1: 400, h6: 900, h24: 2000 } }))).toBe(true);
  });
  it("fails on any failed safety item or an unverified contract", async () => {
    const { passesScamCheck } = await import("@/lib/decision/check-token");
    expect(passesScamCheck(full({ holders: { ...cleanHolders, bundlePct: 30, launchBuyersHoldPct: 10 } }))).toBe(false);
    expect(passesScamCheck(full({ dev: { launches: 20, migrated: 0, score: 0 } }))).toBe(false);
    expect(passesScamCheck(full({ security: null }))).toBe(false);
  });
});
