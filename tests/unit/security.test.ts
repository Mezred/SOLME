import { describe, expect, it } from "vitest";
import { normalizeEvm, normalizeSolana, unavailableReport } from "@/lib/providers/goplus";

describe("GoPlus EVM normalization", () => {
  it("treats empty tax fields as unavailable, not zero", () => {
    const r = normalizeEvm({ is_honeypot: "0", buy_tax: "", sell_tax: "", is_open_source: "1" });
    expect(r.checks.find((c) => c.key === "buy_tax")!.result).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "sell_tax")!.result).toBe("unavailable");
    expect(r.status).toBe("partial");
  });

  it("rates a honeypot as critical", () => {
    const r = normalizeEvm({ is_honeypot: "1", is_open_source: "1", sell_tax: "0", buy_tax: "0" });
    expect(r.riskLevel).toBe("critical");
  });

  it("rates high sell tax as critical and moderate tax as a warning", () => {
    expect(normalizeEvm({ sell_tax: "0.6", buy_tax: "0" }).riskLevel).toBe("critical");
    const warn = normalizeEvm({ sell_tax: "0.12", buy_tax: "0", is_honeypot: "0" });
    expect(warn.checks.find((c) => c.key === "sell_tax")!.result).toBe("warn");
  });

  it("excludes pool and locked holders from concentration", () => {
    const r = normalizeEvm(
      {
        is_honeypot: "0",
        holders: [
          { address: "0xPOOL", percent: "0.60" },
          { address: "0xlocker", percent: "0.10", is_locked: 1 },
          { address: "0xa", percent: "0.05" },
          { address: "0xb", percent: "0.03" },
        ],
      },
      ["0xpool"],
    );
    expect(r.top10HolderPct).toBe(8);
  });
});

describe("GoPlus Solana normalization", () => {
  const clean = {
    mintable: { status: "0" }, freezable: { status: "0" }, balance_mutable_authority: { status: "0" },
    closable: { status: "0" }, metadata_mutable: { status: "0" }, transfer_fee: {}, transfer_fee_upgradable: { status: "0" },
    transfer_hook: [], non_transferable: "0", holder_count: "15739",
    holders: [{ account: "POOL", percent: "0.0459" }, { account: "W1", percent: "0.0013" }],
  };

  it("reports honeypot and LP lock as unavailable on Solana", () => {
    const r = normalizeSolana(clean, ["POOL"]);
    expect(r.checks.find((c) => c.key === "honeypot")!.result).toBe("unavailable");
    expect(r.checks.find((c) => c.key === "lp_lock")!.result).toBe("unavailable");
    expect(r.status).toBe("partial");
    expect(r.riskLevel).toBe("low");
    expect(r.holderCount).toBe(15739);
    expect(r.top10HolderPct).toBeCloseTo(0.13, 2);
  });

  it("flags active mint authority as critical", () => {
    const r = normalizeSolana({ ...clean, mintable: { status: "1" } });
    expect(r.riskLevel).toBe("critical");
  });
});

describe("unavailable reports", () => {
  it("are never presented as clean", () => {
    const r = unavailableReport("no data");
    expect(r.status).toBe("unavailable");
    expect(r.riskLevel).toBe("unknown");
    expect(r.checks.filter((c) => c.result === "pass")).toHaveLength(0);
  });
});
