import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeSolana } from "@/lib/providers/goplus";
import { decodeMint, mintChecks, SPL_TOKEN, TOKEN_2022 } from "@/lib/providers/onchain-security";
import { getHolderReport, HOLDER_BUDGET, HolderBudgetError } from "@/lib/tokens/holders";

/** An 82-byte SPL mint, optionally followed by Token-2022 extensions (type, value). */
function mint(opts: { mintAuth?: boolean; freezeAuth?: boolean; ext?: [number, Buffer][] } = {}) {
  const base = Buffer.alloc(82);
  if (opts.mintAuth) base.writeUInt32LE(1, 0);
  if (opts.freezeAuth) base.writeUInt32LE(1, 46);
  if (!opts.ext) return base.toString("base64");
  const head = Buffer.concat([base, Buffer.alloc(165 - 82), Buffer.from([1])]);
  const tlv = opts.ext.map(([type, v]) => {
    const h = Buffer.alloc(4);
    h.writeUInt16LE(type, 0);
    h.writeUInt16LE(v.length, 2);
    return Buffer.concat([h, v]);
  });
  return Buffer.concat([head, ...tlv]).toString("base64");
}
const key = () => Buffer.alloc(32, 7);
const fee = (bps: number) => {
  const v = Buffer.alloc(108);
  v.writeUInt16LE(bps, 106);
  return v;
};
const byKey = (checks: { key: string; result: string }[]) => Object.fromEntries(checks.map((c) => [c.key, c.result]));

describe("Solana mint read on-chain", () => {
  it("reads classic SPL authorities", () => {
    expect(decodeMint(mint(), SPL_TOKEN)).toMatchObject({ token2022: false, mintAuthority: false, freezeAuthority: false });
    expect(byKey(mintChecks(decodeMint(mint({ mintAuth: true, freezeAuth: true }), SPL_TOKEN)!))).toMatchObject({ mint_authority: "fail", freeze_authority: "fail", token_extensions: "pass" });
    expect(decodeMint(mint(), "SomeOtherProgram111111111111111111111111111")).toBeNull();
  });

  it("flags the Token-2022 traps", () => {
    const pausable = Buffer.concat([key(), Buffer.from([1])]);
    const hook = Buffer.concat([Buffer.alloc(32), key()]);
    const m = decodeMint(mint({ ext: [[1, fee(1500)], [6, Buffer.from([2])], [12, key()], [14, hook], [26, pausable], [3, key()]] }), TOKEN_2022)!;
    expect(m).toMatchObject({ transferFeeBps: 1500, defaultFrozen: true, permanentDelegate: true, transferHook: true, pausable: true, paused: true, closeAuthority: true });
    expect(byKey(mintChecks(m))).toMatchObject({
      transfer_fee: "fail", permanent_delegate: "fail", default_frozen: "fail", paused: "fail", transfer_hook: "warn", closable: "warn", mint_authority: "pass",
    });
  });

  it("passes a clean Token-2022 mint and warns on a small fee", () => {
    const clean = byKey(mintChecks(decodeMint(mint({ ext: [[18, Buffer.alloc(64)]] }), TOKEN_2022)!));
    expect(Object.values(clean).every((r) => r === "pass")).toBe(true);
    expect(byKey(mintChecks(decodeMint(mint({ ext: [[1, fee(100)]] }), TOKEN_2022)!)).transfer_fee).toBe("warn");
  });

  it("overrides GoPlus with what the chain says and treats a permanent delegate as critical", () => {
    const goplusSaysRevoked = { mintable: { status: "0" }, freezable: { status: "0" }, holders: [] };
    const onchain = mintChecks(decodeMint(mint({ mintAuth: true, ext: [[12, key()]] }), TOKEN_2022)!);
    const r = normalizeSolana(goplusSaysRevoked, [], onchain);
    expect(byKey(r.checks)).toMatchObject({ mint_authority: "fail", permanent_delegate: "fail" });
    expect(r.riskLevel).toBe("critical");
    expect(r.provider).toBe("goplus+rpc");
  });
});

describe("holder-check budget", () => {
  let db: Database;
  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
  });
  afterAll(async () => {
    setDbOverride(undefined);
    await db.close();
  });

  it("stops a user who starts too many fresh holder checks", async () => {
    (env as { heliusApiKey?: string }).heliusApiKey = "test-key"; // holder data is only offered with a key
    const ms = HOLDER_BUDGET.perUserWindowSeconds * 1000;
    const start = Math.floor(Date.now() / ms) * ms;
    for (const w of [start, start + ms]) await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ('holders:user:u1', $1, $2)", [new Date(w), HOLDER_BUDGET.perUser]);
    await expect(getHolderReport("solana", "SomeMint1111111111111111111111111111111111", { budgetUserId: "u1" })).rejects.toBeInstanceOf(HolderBudgetError);
    (env as { heliusApiKey?: string }).heliusApiKey = undefined;
  });
});
