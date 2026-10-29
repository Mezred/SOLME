import { describe, expect, it } from "vitest";
import { decodeBondingCurve, decodeLaunchLabPool, devScoreV2, findCreates, findFunder, heldAfterMigration, LAUNCHLAB_PROGRAM, parseLaunchLabInitArgs, parseStreamMessage, PUMP_PROGRAM } from "@/lib/launchpad/pump";
import type { LaunchOutcome } from "@/lib/launchpad/pump";
import type { RawTx } from "@/lib/providers/helius-history";

function curve(realTokens: number, realSol: number, complete = false, virtualSol = 30) {
  const b = Buffer.alloc(166);
  b.writeBigUInt64LE(BigInt(Math.round((1_073_000_000 - (793_100_000 - realTokens)) * 1e6)), 8);
  b.writeBigUInt64LE(BigInt(Math.round(virtualSol * 1e9)), 16);
  b.writeBigUInt64LE(BigInt(Math.round(realTokens * 1e6)), 24);
  b.writeBigUInt64LE(BigInt(Math.round(realSol * 1e9)), 32);
  b.writeBigUInt64LE(BigInt(1e15), 40);
  b[48] = complete ? 1 : 0;
  return b.toString("base64");
}

describe("decodeBondingCurve", () => {
  it("reads a fresh curve at ~28 SOL market cap and 0% progress", () => {
    const s = decodeBondingCurve(curve(793_100_000, 0))!;
    expect(s.progress).toBe(0);
    expect(s.marketCapSol).toBeCloseTo(27.959, 2);
    expect(s.complete).toBe(false);
  });

  it("derives progress and market cap from real reserves, ignoring odd virtual values", () => {
    const half = decodeBondingCurve(curve(396_550_000, 42, false, 770))!;
    expect(half.progress).toBeCloseTo(0.5, 3);
    expect(half.marketCapSol).toBeCloseTo(((30 + 42) / (1_073_000_000 - 396_550_000)) * 1e9, 3);
    expect(decodeBondingCurve(curve(0, 85, true))!.progress).toBe(1);
  });

  it("rejects short buffers", () => {
    expect(decodeBondingCurve(Buffer.alloc(20).toString("base64"))).toBeNull();
  });
});

describe("parseStreamMessage", () => {
  it("parses a create event from the live feed shape", () => {
    const ev = parseStreamMessage({ signature: "s", mint: "M", traderPublicKey: "D", txType: "create", solAmount: 1.2, bondingCurveKey: "C", marketCapSol: 28, name: "Name", symbol: "SYM", uri: "u", pool: "pump" });
    expect(ev).toEqual({ kind: "create", mint: "M", creator: "D", pool: "pump", name: "Name", symbol: "SYM", uri: "u", bondingCurve: "C", initialBuySol: 1.2, marketCapSol: 28 });
  });

  it("parses migrations and ignores acknowledgements", () => {
    expect(parseStreamMessage({ mint: "M", txType: "migrate" })).toEqual({ kind: "migrate", mint: "M" });
    expect(parseStreamMessage({ message: "Successfully subscribed to token creation events." })).toBeNull();
    expect(parseStreamMessage({ mint: "M", txType: "buy" })).toBeNull();
  });
});

describe("findCreates", () => {
  const dev = "Dev1111111111111111111111111111111111111111";
  const mint = "Mint111111111111111111111111111111111111pump";
  const tx = (logs: string[], payer = dev): RawTx => ({
    slot: 1,
    blockTime: 1_790_000_000,
    transaction: { signatures: ["sig"], message: { accountKeys: [payer, mint, PUMP_PROGRAM], header: { numRequiredSignatures: 2 } } },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], postTokenBalances: [{ accountIndex: 3, mint, owner: "Curve", uiTokenAmount: { amount: "1", decimals: 6 } }], logMessages: logs },
  });

  it("finds the co-signing mint of a create instruction", () => {
    expect(findCreates(dev, [tx(["Program log: Instruction: Create"])])).toEqual([{ mint, time: 1_790_000_000, signature: "sig", pool: "pump" }]);
    expect(findCreates(dev, [tx(["Program log: Instruction: CreateV2"])])).toHaveLength(1);
  });

  it("ignores buys and transactions paid by someone else", () => {
    expect(findCreates(dev, [tx(["Program log: Instruction: Buy"])])).toHaveLength(0);
    expect(findCreates(dev, [tx(["Program log: Instruction: Create"], "Other111111111111111111111111111111111111111")])).toHaveLength(0);
  });
});

describe("LetsBonk / LaunchLab", () => {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const enc58 = (bytes: Buffer) => {
    let n = BigInt("0x" + (bytes.toString("hex") || "0"));
    let s = "";
    while (n > BigInt(0)) {
      s = B58[Number(n % BigInt(58))] + s;
      n /= BigInt(58);
    }
    for (const b of bytes) {
      if (b !== 0) break;
      s = "1" + s;
    }
    return s;
  };

  it("decodes a pool: progress from base sold, market cap in quote units, mints and creator", () => {
    const b = Buffer.alloc(429);
    b[17] = 0; // Fund
    b[18] = 6;
    b[19] = 9;
    const u64 = (o: number, v: number) => b.writeBigUInt64LE(BigInt(Math.round(v)), o);
    u64(21, 1e9 * 1e6); // supply
    u64(29, 793_100_000 * 1e6); // total_base_sell
    u64(37, 1_073_025_605 * 1e6); // virtual_base
    u64(45, 30 * 1e9); // virtual_quote (SOL)
    u64(53, 396_550_000 * 1e6); // real_base (half sold)
    u64(61, 20 * 1e9); // real_quote
    // Pubkeys start at 141 (documented layout, confirmed on live pools): base +64, quote +96, creator +192.
    Buffer.alloc(32, 7).copy(b, 141 + 64); // base mint
    Buffer.alloc(32, 9).copy(b, 141 + 96); // quote mint
    Buffer.alloc(32, 3).copy(b, 141 + 192); // creator
    const s = decodeLaunchLabPool(b.toString("base64"))!;
    expect(s.progress).toBeCloseTo(0.5, 3);
    expect(s.complete).toBe(false);
    expect(s.marketCapQuote).toBeCloseTo((50 / (1_073_025_605 - 396_550_000)) * 1e9, 3);
    expect(s.baseMint).toBe(enc58(Buffer.alloc(32, 7)));
    expect(s.quoteMint).toBe(enc58(Buffer.alloc(32, 9)));
    expect(s.creator).toBe(enc58(Buffer.alloc(32, 3)));
    b[17] = 1; // Migrate
    expect(decodeLaunchLabPool(b.toString("base64"))!.complete).toBe(true);
  });

  it("parses name/symbol/uri from the initialize instruction data", () => {
    const str = (s: string) => Buffer.concat([Buffer.from(Uint32Array.of(Buffer.byteLength(s)).buffer), Buffer.from(s)]);
    const data = Buffer.concat([Buffer.alloc(8, 1), Buffer.from([6]), str("StonkBot"), str("SBOT"), str("https://gateway.irys.xyz/x"), Buffer.alloc(20)]);
    expect(parseLaunchLabInitArgs(enc58(data))).toEqual({ name: "StonkBot", symbol: "SBOT", uri: "https://gateway.irys.xyz/x" });
    expect(parseLaunchLabInitArgs(enc58(Buffer.alloc(30, 0xff)))).toBeNull();
  });

  it("trusts only the signature of PumpPortal's bonk creates", () => {
    expect(parseStreamMessage({ signature: "sig", mint: "QUOTE", traderPublicKey: "X", txType: "create", pool: "bonk" })).toEqual({ kind: "launchlab_create", signature: "sig" });
  });

  it("finds LaunchLab creations in a creator's history", () => {
    const dev = "Dev1111111111111111111111111111111111111111";
    const mint = "Mint11111111111111111111111111111111111bonk";
    const tx: RawTx = {
      slot: 1,
      blockTime: 1_790_000_000,
      transaction: { signatures: ["sig"], message: { accountKeys: [dev, mint, LAUNCHLAB_PROGRAM], header: { numRequiredSignatures: 2 } } },
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [], postTokenBalances: [{ accountIndex: 3, mint, owner: "Vault", uiTokenAmount: { amount: "1", decimals: 6 } }], logMessages: ["Program log: Instruction: InitializeWithToken2022", "Program log: Instruction: InitializeMint2"] },
    };
    expect(findCreates(dev, [tx])).toEqual([{ mint, time: 1_790_000_000, signature: "sig", pool: "bonk" }]);
  });
});

const launch = (o: Partial<LaunchOutcome> = {}): LaunchOutcome => ({ migrated: false, held: null, devDumped: false, ageDays: 2, mcapUsd: null, ...o });
const held = (mcapUsd = 500_000, ageDays = 2) => launch({ migrated: true, held: true, mcapUsd, ageDays });

describe("dev score v2", () => {
  it("rewards migrations that held, caps everyone else at 40", () => {
    expect(devScoreV2([]).score).toBeNull();
    const serial = devScoreV2(Array.from({ length: 20 }, () => launch())).score!;
    expect(serial).toBeLessThanOrEqual(10);
    expect(devScoreV2([held(2_000_000), held(), launch(), launch()]).score!).toBeGreaterThanOrEqual(90);
    // Same record, but the migrations collapsed or the dev dumped: not proven.
    expect(devScoreV2([launch({ migrated: true, held: false }), launch({ migrated: true, held: false }), launch()]).score!).toBeLessThanOrEqual(40);
    expect(devScoreV2([launch({ migrated: true, devDumped: true, mcapUsd: 2_000_000 }), launch()]).score!).toBeLessThanOrEqual(40);
  });

  it("does not let one lucky launch look like a great dev, and weights recent launches more", () => {
    const lucky = devScoreV2([held(), launch()]);
    const steady = devScoreV2([held(), held(), held(), launch(), launch(), launch()]);
    expect(lucky.score!).toBeLessThan(steady.score!);
    expect(lucky.confidence).toBe("low");
    expect(steady.confidence).toBe("medium");
    // A migration from 4 months ago counts far less than one from this week.
    const old = devScoreV2([held(500_000, 120), launch(), launch(), launch()]).score!;
    const fresh = devScoreV2([held(500_000, 2), launch(), launch(), launch()]).score!;
    expect(fresh).toBeGreaterThan(old);
  });

  it("calls a migration held when the market cap an hour later keeps half its value", () => {
    expect(heldAfterMigration(60_000, 45_000)).toBe(true);
    expect(heldAfterMigration(60_000, 12_000)).toBe(false);
    expect(heldAfterMigration(60_000, null)).toBeNull();
    expect(heldAfterMigration(null, 45_000)).toBeNull();
  });

  it("finds the wallet that first funded a creator", () => {
    const tx = (payer: string, pre: number, post: number): RawTx => ({
      slot: 1,
      blockTime: 1,
      transaction: { signatures: ["s"], message: { accountKeys: [payer, "Dev"] } },
      meta: { err: null, fee: 5000, preBalances: [10, pre], postBalances: [9, post] },
    });
    expect(findFunder("Dev", [tx("Dev", 5, 4), tx("Funder", 0, 2_000_000_000)])).toBe("Funder");
    expect(findFunder("Dev", [tx("Other", 5, 5)])).toBeNull();
  });
});
