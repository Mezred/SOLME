import { afterEach, describe, expect, it, vi } from "vitest";
import { goplus, normalizeSolana, unavailableReport } from "@/lib/providers/goplus";

describe("goplus.check request strategy (live regression)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries each token individually because batches only answer for the first address", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const first = new URL(url).searchParams.get("contract_addresses")!.split(",")[0];
      return new Response(JSON.stringify({ code: 1, message: "OK", result: { [first]: { mintable: { status: "0" }, freezable: { status: "0" }, holders: [] } } }), { status: 200 });
    });
    const a = "MintAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
    const b = "MintBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    const out = await goplus.check("solana", [a, b]);
    expect(urls.filter((u) => u.includes("gopluslabs"))).toHaveLength(2);
    expect(out.get(a)!.status).not.toBe("unavailable");
    expect(out.get(b)!.status).not.toBe("unavailable");
  });

  it("skips (rather than storing 'unavailable') when the provider returns an error code", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: 4029, message: "rate limited" }), { status: 200 }));
    const out = await goplus.check("solana", ["MintCcccccccccccccccccccccccccccccccccccccc3"]);
    expect(out.size).toBe(0);
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
