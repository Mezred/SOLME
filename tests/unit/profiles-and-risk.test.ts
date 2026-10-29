import { describe, expect, it } from "vitest";
import { decide, type DecisionInput } from "@/lib/decision/verdict";
import { devReputation, launchOutcome } from "@/lib/devs/profile";
import { copyAfterCosts, performanceConfidence, walletBehaviour, walletRisks, type WalletFacts } from "@/lib/wallets/profile";

describe("Coin Check overall risk", () => {
  const base: DecisionInput = {
    priceUsd: 0.001, change: { m5: 1, h1: 20, h6: 50, h24: 100 }, liquidityUsd: 60_000, marketCapUsd: 500_000, ageHours: 4,
    buysH1: 300, sellsH1: 250, security: { riskLevel: "low", failedChecks: [], warnings: [] },
    holders: { top10WalletPct: 15, devPct: 1, bundlePct: 2, launchBuyersHoldPct: 2 },
  };
  it("is Low only when every check ran clean, and never says 'safe'", () => {
    const d = decide(base);
    expect(d.risk).toBe("low");
    expect(d.findings.every((g) => g.status === "pass")).toBe(true);
  });
  it("is Moderate for caution points or checks that could not run", () => {
    expect(decide({ ...base, holders: null }).risk).toBe("moderate");
    expect(decide({ ...base, holders: { ...base.holders!, devPct: 7 } }).risk).toBe("moderate");
  });
  it("is High for serious non-trap findings and Critical for traps", () => {
    expect(decide({ ...base, holders: { ...base.holders!, top10WalletPct: 55 } }).risk).toBe("high");
    const trap = decide({ ...base, security: { riskLevel: "critical", failedChecks: ["Freeze authority: active"], warnings: [] } });
    expect(trap.risk).toBe("critical");
    expect(trap.findings[0]).toMatchObject({ key: "transfer", status: "fail", basis: "confirmed" });
  });
  it("labels how each finding is known", () => {
    const d = decide({ ...base, holders: null, security: null });
    expect(d.gate.find((g) => g.key === "contract")?.basis).toBe("unavailable");
    expect(d.gate.find((g) => g.key === "liquidity")?.basis).toBe("confirmed");
  });
});

describe("developer reputation", () => {
  it("classifies from the record without calling anyone a scammer", () => {
    expect(devReputation({ launches: 1, migrated: 0, score: null, confidence: null })).toBe("new");
    expect(devReputation({ launches: 8, migrated: 4, score: 75, confidence: "high" })).toBe("proven");
    expect(devReputation({ launches: 3, migrated: 2, score: 70, confidence: "low" })).toBe("promising");
    expect(devReputation({ launches: 14, migrated: 0, score: 5, confidence: "medium" })).toBe("serial");
    expect(devReputation({ launches: 4, migrated: 0, score: 10, confidence: "low" })).toBe("unproven");
    expect(devReputation({ launches: 10, migrated: 2, score: 40, confidence: "medium" })).toBe("mixed");
  });
  it("reads each launch's outcome", () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    expect(launchOutcome({ complete: true, migrated_at: old, created_at: old, mcap_at_migration_usd: 60_000, held_mcap_usd: 45_000 })).toBe("held");
    expect(launchOutcome({ complete: true, migrated_at: old, created_at: old, mcap_at_migration_usd: 60_000, held_mcap_usd: 10_000 })).toBe("collapsed");
    expect(launchOutcome({ complete: false, migrated_at: null, created_at: old, mcap_at_migration_usd: null, held_mcap_usd: null })).toBe("failed");
    expect(launchOutcome({ complete: false, migrated_at: null, created_at: new Date(), mcap_at_migration_usd: null, held_mcap_usd: null })).toBe("curve");
  });
});

describe("smart wallet profile", () => {
  const f: WalletFacts = { trades: 300, decided: 40, wins: 22, pnlSol: 35, earlyEntries: 10, medianHoldMinutes: 240, botLike: false, coveredDays: 30, oos: "held_up", insiderReason: null };
  it("describes how a wallet trades", () => {
    expect(walletBehaviour(f).label).toBe("Day trader");
    expect(walletBehaviour({ ...f, earlyEntries: 30, medianHoldMinutes: 20 }).label).toBe("Early flipper");
    expect(walletBehaviour({ ...f, botLike: true }).label).toBe("Bot-like");
    expect(walletBehaviour({ ...f, medianHoldMinutes: 4000 }).label).toBe("Swing holder");
  });
  it("keeps copy returns apart, after modeled costs, and says how far to trust the record", () => {
    expect(copyAfterCosts(12, 20)).toBe(9);
    expect(copyAfterCosts(null, 0)).toBeNull();
    expect(performanceConfidence(3).level).toBe("none");
    expect(performanceConfidence(40).level).toBe("high");
  });
  it("lists risk indicators", () => {
    expect(walletRisks({ ...f, insiderReason: "funded by a coin creator", oos: "faded" })).toEqual([
      "Possible launch insider: funded by a coin creator (inferred from funding links)",
      "Its last 10 days lost money: the record may be fading",
    ]);
  });
});
