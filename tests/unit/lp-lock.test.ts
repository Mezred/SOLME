import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { base58, PUMP_PROGRAM } from "@/lib/launchpad/pump";
import { decodePool, lpCheck, PUMPSWAP_PROGRAM, RAYDIUM_CPMM_PROGRAM, solanaLpChecks } from "@/lib/providers/onchain-security";

/** A 32-byte key filled with one byte, and its base58 form. */
const key = (n: number) => Buffer.alloc(32, n);
const k58 = (n: number) => base58(key(n));

function pumpswapPool(base: number, quote: number, lp: number, lpSupply: number) {
  const b = Buffer.alloc(300);
  key(base).copy(b, 43);
  key(quote).copy(b, 75);
  key(lp).copy(b, 107);
  b.writeBigUInt64LE(BigInt(lpSupply), 203);
  return b.toString("base64");
}
function cpmmPool(m0: number, m1: number, lp: number, lpSupply: number) {
  const b = Buffer.alloc(637);
  key(lp).copy(b, 136);
  key(m0).copy(b, 168);
  key(m1).copy(b, 200);
  b.writeBigUInt64LE(BigInt(lpSupply), 333);
  return b.toString("base64");
}
function mintAccount(supply: number, decimals = 9) {
  const b = Buffer.alloc(82);
  b.writeBigUInt64LE(BigInt(supply), 36);
  b[44] = decimals;
  return b.toString("base64");
}
function tokenAccount(owner: number) {
  const b = Buffer.alloc(165);
  key(owner).copy(b, 32);
  return b.toString("base64");
}

describe("pool LP decoding and thresholds", () => {
  it("reads PumpSwap and Raydium CPMM pools at their verified offsets, and nothing else", () => {
    expect(decodePool(PUMPSWAP_PROGRAM, pumpswapPool(1, 2, 3, 5000))).toEqual({ dex: "PumpSwap", lpMint: k58(3), poolLpSupply: 5000, mints: [k58(1), k58(2)] });
    expect(decodePool(RAYDIUM_CPMM_PROGRAM, cpmmPool(1, 2, 3, 7000))).toEqual({ dex: "Raydium CPMM", lpMint: k58(3), poolLpSupply: 7000, mints: [k58(1), k58(2)] });
    expect(decodePool("SomeClmmProgram1111111111111111111111111111", pumpswapPool(1, 2, 3, 5000))).toBeNull();
  });

  it("passes burned or locked LP and fails LP someone can withdraw", () => {
    expect(lpCheck("PumpSwap", 1000, 0, 0)).toMatchObject({ result: "pass", detail: "PumpSwap LP: 100.0% burned" });
    expect(lpCheck("Raydium CPMM", 1000, 400, 380)).toMatchObject({ result: "pass", detail: "Raydium CPMM LP: 60.0% burned, 38.0% locked" });
    expect(lpCheck("Raydium CPMM", 1000, 1000, 700)).toMatchObject({ result: "warn" });
    expect(lpCheck("Raydium CPMM", 1000, 1000, 0)).toMatchObject({ result: "fail", detail: expect.stringContaining("can pull the liquidity") });
    // Launchpad migration whose LP sits with the platform, not the creator: a warning, naming the wallet.
    expect(lpCheck("Raydium CPMM", 1000, 1000, 0, { fromLaunchpad: true, topHolder: "3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH" })).toMatchObject({
      result: "warn",
      detail: "Raydium CPMM LP: none burned or locked; 100% held by wallet 3f7G…ekxH (usually the launch platform), not the creator",
    });
    // The creator holding it is a fail even on a launchpad coin.
    expect(lpCheck("Raydium CPMM", 1000, 1000, 0, { fromLaunchpad: true, creatorRaw: 900 })).toMatchObject({ result: "fail", detail: expect.stringContaining("the creator holds 90%") });
  });
});

describe("LP check against the chain (fake RPC)", () => {
  // Coins: 10 burned PumpSwap, 11 CPMM mostly in Raydium's locker, 12 CPMM held by the dev, 13 still on the pump.fun curve.
  const accounts: Record<string, { owner: string; data: string } | null> = {
    [k58(110)]: { owner: PUMPSWAP_PROGRAM, data: pumpswapPool(10, 99, 210, 1_000_000) },
    [k58(111)]: { owner: RAYDIUM_CPMM_PROGRAM, data: cpmmPool(11, 99, 211, 1_000_000) },
    [k58(112)]: { owner: RAYDIUM_CPMM_PROGRAM, data: cpmmPool(12, 99, 212, 1_000_000) },
    [k58(113)]: { owner: PUMP_PROGRAM, data: Buffer.alloc(150).toString("base64") },
    [k58(210)]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: mintAccount(0) },
    [k58(211)]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: mintAccount(1_000_000) },
    [k58(212)]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: mintAccount(1_000_000) },
    [k58(31)]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: tokenAccount(41) }, // LP of coin 11 → locker PDA
    [k58(32)]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: tokenAccount(42) }, // LP of coin 12 → dev wallet
    [k58(41)]: { owner: "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE", data: "" },
    [k58(42)]: { owner: "11111111111111111111111111111111", data: "" },
  };
  const largest: Record<string, { address: string; uiAmount: number }[]> = {
    [k58(211)]: [{ address: k58(31), uiAmount: 0.00099 }], // 990,000 raw of 1,000,000
    [k58(212)]: [{ address: k58(32), uiAmount: 0.001 }],
  };

  beforeAll(() => {
    (env as { heliusApiKey?: string }).heliusApiKey = "test-key";
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body);
      const result =
        method === "getMultipleAccounts"
          ? { value: (params[0] as string[]).map((a) => (accounts[a] ? { owner: accounts[a]!.owner, data: [accounts[a]!.data, "base64"] } : null)) }
          : { value: largest[params[0]] ?? [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    (env as { heliusApiKey?: string }).heliusApiKey = undefined;
  });

  it("finds burned, locked, withdrawable and curve liquidity", async () => {
    const pools = new Map([[k58(10), k58(110)], [k58(11), k58(111)], [k58(12), k58(112)], [k58(13), k58(113)]]);
    const out = await solanaLpChecks(pools);
    expect(out.get(k58(10))).toMatchObject({ result: "pass", detail: "PumpSwap LP: 100.0% burned" });
    expect(out.get(k58(11))).toMatchObject({ result: "pass", detail: "Raydium CPMM LP: 99.0% locked" });
    expect(out.get(k58(12))).toMatchObject({ result: "fail" });
    expect(out.get(k58(13))).toMatchObject({ result: "pass", detail: expect.stringContaining("bonding curve") });
  });
});
