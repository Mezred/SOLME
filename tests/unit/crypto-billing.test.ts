import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmCryptoPayment, formatBase, paysQuote, quoteBase, solanaPayUrl, USDC_MINT, type CryptoPayment } from "@/lib/billing/crypto";
import { getEntitlements } from "@/lib/billing/entitlements";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import type { RawTx } from "@/lib/providers/helius-history";

const RECIPIENT = "Rcpt111111111111111111111111111111111111111";
const PAYER = "Payer11111111111111111111111111111111111111";

describe("quotes", () => {
  it("prices USDC exactly, with a unique tail under one cent", () => {
    expect(quoteBase(2900, "USDC", null, 417).toString()).toBe("29000417");
    expect(formatBase("29000417", "USDC")).toBe("29.000417");
    expect(formatBase("29000000", "USDC")).toBe("29");
  });

  it("prices SOL at the given rate, rounded up to 0.0001 SOL before the tail", () => {
    // $29 at $145/SOL = 0.2 SOL exactly.
    expect(quoteBase(2900, "SOL", 145, 1234).toString()).toBe("200001234");
    expect(formatBase("200001234", "SOL")).toBe("0.200001234");
    expect(() => quoteBase(2900, "SOL", null, 1)).toThrow();
  });

  it("builds a Solana Pay transfer request with the reference and the USDC mint", () => {
    const url = solanaPayUrl({ id: "abcdef12-0000", recipient: RECIPIENT, amount_base: "29000417", currency: "USDC", reference: "Ref111", plan_id: "pro", billing_interval: "month" }, "Pro");
    expect(url.startsWith(`solana:${RECIPIENT}?amount=29.000417&spl-token=${USDC_MINT}&reference=Ref111`)).toBe(true);
    expect(url).toContain("message=SOLME%20Pro%20%C2%B7%201%20month");
  });
});

describe("matching a transaction to a quote", () => {
  const created = new Date(1_790_000_000 * 1000);
  const usdcQuote = { recipient: RECIPIENT, currency: "USDC" as const, amount_base: "29000417", created_at: created };
  const usdcTx = (amount: number, opts: { err?: unknown; time?: number; owner?: string } = {}): RawTx => ({
    slot: 1,
    blockTime: opts.time ?? 1_790_000_100,
    transaction: { signatures: ["sig"], message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: "Ata1" }] } },
    meta: {
      err: opts.err ?? null, fee: 5000, preBalances: [1e9, 0], postBalances: [1e9 - 5000, 0],
      preTokenBalances: [{ accountIndex: 1, mint: USDC_MINT, owner: opts.owner ?? RECIPIENT, uiTokenAmount: { amount: "5000000", decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 1, mint: USDC_MINT, owner: opts.owner ?? RECIPIENT, uiTokenAmount: { amount: String(5_000_000 + amount), decimals: 6 } }],
    },
  });

  it("accepts a USDC transfer of at least the amount (by reference) and exactly the amount (pasted signature)", () => {
    expect(paysQuote(usdcTx(29_000_417), usdcQuote, false)).toEqual({ payer: PAYER });
    expect(paysQuote(usdcTx(30_000_000), usdcQuote, false)).not.toBeNull();
    expect(paysQuote(usdcTx(30_000_000), usdcQuote, true)).toBeNull();
    expect(paysQuote(usdcTx(29_000_417), usdcQuote, true)).not.toBeNull();
  });

  it("rejects short, failed, earlier, or someone else's transfers", () => {
    expect(paysQuote(usdcTx(29_000_416), usdcQuote, false)).toBeNull();
    expect(paysQuote(usdcTx(29_000_417, { err: { InstructionError: [] } }), usdcQuote, false)).toBeNull();
    expect(paysQuote(usdcTx(29_000_417, { time: 1_789_990_000 }), usdcQuote, false)).toBeNull();
    expect(paysQuote(usdcTx(29_000_417, { owner: PAYER }), usdcQuote, false)).toBeNull();
  });

  it("reads SOL from the recipient's lamport balance", () => {
    const tx: RawTx = {
      slot: 1, blockTime: 1_790_000_100,
      transaction: { signatures: ["s"], message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: RECIPIENT }] } },
      meta: { err: null, fee: 5000, preBalances: [5e9, 1e9], postBalances: [5e9 - 200_006_234, 1e9 + 200_001_234] },
    };
    const q = { recipient: RECIPIENT, currency: "SOL" as const, amount_base: "200001234", created_at: created };
    expect(paysQuote(tx, q, true)).toEqual({ payer: PAYER });
    expect(paysQuote(tx, { ...q, amount_base: "200001235" }, false)).toBeNull();
  });
});

describe("confirming payments", () => {
  let db: Database;
  let user: string;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
    [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('crypto@test.dev') RETURNING id");
  });
  afterAll(async () => {
    setDbOverride(undefined);
    await db.close();
  });

  const quote = async (plan: string, interval: "month" | "year" = "month") =>
    (
      await db.query<CryptoPayment>(
        `INSERT INTO crypto_payments (user_id, plan_id, billing_interval, currency, amount_base, amount_usd_cents, recipient, reference, expires_at)
         VALUES ($1, $2, $3, 'USDC', $4, 2900, $5, $6, now() + interval '30 minutes') RETURNING *`,
        [user, plan, interval, 29_000_000 + ++n, RECIPIENT, `ref${n}`],
      )
    )[0];
  const daysLeft = (d: Date | null) => Math.round((new Date(d!).getTime() - Date.now()) / 86_400_000);

  it("activates the plan for the paid period and records the payment", async () => {
    const p = await quote("pro");
    expect(await confirmCryptoPayment(p, "sigA", PAYER)).toBe(true);
    const ent = await getEntitlements(user);
    expect(ent.planId).toBe("pro");
    expect(ent.subscription?.source).toBe("crypto");
    expect(daysLeft(ent.subscription!.currentPeriodEnd)).toBe(30);
    expect(await db.query("SELECT 1 FROM payment_events WHERE event_id = 'sigA' AND event_type = 'crypto.paid'")).toHaveLength(1);
  });

  it("never credits a quote twice or reuses a signature", async () => {
    const [p] = await db.query<CryptoPayment>("SELECT * FROM crypto_payments WHERE signature = 'sigA'");
    expect(await confirmCryptoPayment(p, "sigA", PAYER)).toBe(false);
    expect(await confirmCryptoPayment(await quote("pro"), "sigA", PAYER)).toBe(false);
    expect(daysLeft((await getEntitlements(user)).subscription!.currentPeriodEnd)).toBe(30);
  });

  it("renewing early adds the period on top of the current one", async () => {
    expect(await confirmCryptoPayment(await quote("pro"), "sigB", PAYER)).toBe(true);
    expect(daysLeft((await getEntitlements(user)).subscription!.currentPeriodEnd)).toBe(60);
  });

  it("upgrading turns the remaining days into days on the new plan at their value", async () => {
    expect(await confirmCryptoPayment(await quote("elite"), "sigC", PAYER)).toBe(true);
    const ent = await getEntitlements(user);
    expect(ent.planId).toBe("elite");
    // 30 paid days + 60 Pro days × $29/$79 ≈ 22 days.
    expect(daysLeft(ent.subscription!.currentPeriodEnd)).toBe(52);
    expect(await db.query("SELECT 1 FROM subscriptions WHERE user_id = $1 AND plan_id = 'pro' AND status = 'active'", [user])).toHaveLength(0);
  });
});
