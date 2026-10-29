import { describe, expect, it } from "vitest";
import { riskRoseToAlert } from "@/lib/alerts/watch-checks";
import { evidenceLinks } from "@/lib/decision/links";
import { classifyEarly, type EarlyFacts } from "@/lib/early/signals";

const base: EarlyFacts = {
  priceUsd: 0.001,
  change: { m5: 1, h1: 2, h6: 10 },
  volume: { h1: 40_000, h6: 60_000 },
  txns: { buysH1: 300, sellsH1: 150, buysH6: 600, sellsH6: 600 },
  liquidityUsd: 20_000,
  liquidityPeakUsd: 20_000,
  marketCapUsd: 300_000,
  ageHours: 5,
  contractRisk: "low",
  launchCheckPassed: null,
  devScore: null,
  devLaunches: null,
  devSoldPct: null,
  smartWallets: 0,
  smartSol: 0,
  dataAgeMinutes: 3,
  onchainData: true,
};

describe("Early Coins unique buyers", () => {
  it("counts many different wallets buying as its own signal", () => {
    const r = classifyEarly({ ...base, wallets: { buyers: 42, trades: 100, spanMinutes: 35, ageMinutes: 4 } });
    expect(r.signals.map((s) => s.key)).toContain("wallets");
    expect(r.signals.find((s) => s.key === "wallets")!.text).toBe("42 different wallets bought in the last 35 min");
    expect(r.missing).not.toContain("unique buyers (no recent trade sample)");
  });

  it("drops transaction signals when a handful of wallets make the activity (bots), and says so", () => {
    const r = classifyEarly({ ...base, wallets: { buyers: 3, trades: 100, spanMinutes: 20, ageMinutes: 4 } });
    expect(r.signals.map((s) => s.key)).toEqual(["volume"]);
    expect(r.flags.find((f) => f.key === "few")?.text).toBe("Only 3 wallets bought across the last 100 trades");
  });

  it("ignores a stale or missing sample and lists it as missing", () => {
    const stale = classifyEarly({ ...base, wallets: { buyers: 3, trades: 100, spanMinutes: 20, ageMinutes: 45 } });
    expect(stale.signals.map((s) => s.key)).toEqual(["volume", "txns", "buyers"]);
    expect(stale.missing).toContain("unique buyers (no recent trade sample)");
    expect(classifyEarly(base).missing).toContain("unique buyers (no recent trade sample)");
    // Without Helius there can be no sample: covered by the general on-chain note instead.
    expect(classifyEarly({ ...base, onchainData: false }).missing).not.toContain("unique buyers (no recent trade sample)");
  });

  it("does not count a slow sample (over 90 minutes) as a burst of buyers", () => {
    const r = classifyEarly({ ...base, wallets: { buyers: 60, trades: 100, spanMinutes: 300, ageMinutes: 4 } });
    expect(r.signals.map((s) => s.key)).not.toContain("wallets");
  });
});

describe("Coin Check evidence links", () => {
  const links = evidenceLinks({
    mint: "MINT",
    pair: "POOL",
    dev: "DEV",
    creator: "DEV",
    devSells: [{ signature: "SIG1", pct: 4.2 }, { signature: "SIG2", pct: null }],
    clusters: [{ funder: "FUNDER", wallets: 4 }],
  });

  it("links each finding to where it can be verified", () => {
    expect(links.contract).toEqual([{ label: "Token on Solscan", href: "https://solscan.io/token/MINT", external: true }]);
    expect(links.trading?.[0].href).toBe("https://solscan.io/account/POOL");
    expect(links.devsold?.map((l) => [l.label, l.href])).toEqual([
      ["Dev sale 1 (4.2%)", "https://solscan.io/tx/SIG1"],
      ["Dev sale 2", "https://solscan.io/tx/SIG2"],
    ]);
    expect(links.insiders?.map((l) => l.label)).toEqual(["Shared funder (4 wallets)", "Dev wallet"]);
    expect(links.devrecord).toEqual([{ label: "Developer profile", href: "/app/smart-dev/DEV", external: false }]);
  });

  it("never links the sell test (a simulation has no transaction) and omits what is unknown", () => {
    expect(links.sell).toBeUndefined();
    const bare = evidenceLinks({ mint: "M", pair: null, dev: null, creator: null, devSells: [], clusters: [] });
    expect(bare.liquidity).toEqual([]);
    expect(bare.devsold).toEqual([]);
  });
});

describe("watchlist risk re-check", () => {
  it("alerts only when the full check's risk rises into high or critical", () => {
    expect(riskRoseToAlert("low", "high")).toBe(true);
    expect(riskRoseToAlert("high", "critical")).toBe(true);
    expect(riskRoseToAlert("moderate", "moderate")).toBe(false);
    expect(riskRoseToAlert("critical", "high")).toBe(false);
    expect(riskRoseToAlert("low", "moderate")).toBe(false);
    // The first check has nothing to compare with.
    expect(riskRoseToAlert(null, "critical")).toBe(false);
  });
});
