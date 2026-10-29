import { randomBytes, randomInt } from "node:crypto";
import QRCode from "qrcode";
import { sendTelegram } from "@/lib/alerts/telegram";
import { normalizeAddress } from "@/lib/chains";
import { query, queryOne, transaction } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { base58 } from "@/lib/launchpad/pump";
import { errorMessage, logger } from "@/lib/log";
import { getRawTransaction, getSignatures, type RawTx } from "@/lib/providers/helius-history";
import { solPriceUsd } from "@/lib/wallets/smart-money";
import { getPlan } from "./plans";

const log = logger("crypto-billing");

/**
 * Crypto subscriptions: prepaid periods paid on Solana in USDC or SOL, straight to the operator's wallet
 * (SOLANA_PAY_RECIPIENT). No processor, no custody, no automatic renewal.
 *
 * 1. Checkout creates a quote: the plan price in USDC, or in SOL at the current price, plus a few random base units so
 *    the amount is unique, and a random Solana Pay `reference` key. The quote is valid for QUOTE_MINUTES.
 * 2. The user pays from any Solana wallet with the QR code / link (Solana Pay adds the reference to the transfer).
 * 3. The worker (and the open checkout page) finds the transfer by its reference and checks it on-chain: not failed,
 *    after the quote, recipient's USDC / SOL balance up by at least the amount. A transfer sent without the reference
 *    can be claimed by pasting its signature, but then the amount must match the quote exactly.
 * 4. A confirmed payment adds the period to the user's crypto subscription (renewing early loses no days; upgrading
 *    turns the old plan's remaining days into days on the new one). A reminder goes out RENEW_REMIND_DAYS before the end.
 *
 * Each signature can pay for one quote only (UNIQUE), so a transaction cannot be reused.
 */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const QUOTE_MINUTES = 30;
/** Payments that arrive after the quote expired are still credited for this long. */
const LATE_HOURS = 24;
const RENEW_REMIND_DAYS = 3;
export const PERIOD_DAYS = { month: 30, year: 365 } as const;
const DECIMALS = { USDC: 6, SOL: 9 } as const;

export type CryptoCurrency = keyof typeof DECIMALS;
export type Interval = keyof typeof PERIOD_DAYS;

export interface CryptoPayment {
  id: string;
  user_id: string;
  plan_id: string;
  billing_interval: Interval;
  currency: CryptoCurrency;
  amount_base: string;
  amount_usd_cents: number;
  recipient: string;
  reference: string;
  status: "pending" | "confirmed" | "expired";
  signature: string | null;
  payer: string | null;
  subscription_id: string | null;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}

export function cryptoRecipient(): string | null {
  return env.solanaPayRecipient ? normalizeAddress("solana", env.solanaPayRecipient) : null;
}

export function cryptoConfigured(): boolean {
  return Boolean(cryptoRecipient() && env.heliusApiKey);
}

/** Base units → decimal string without float rounding ("29000417" USDC → "29.000417"). */
export function formatBase(base: bigint | string, currency: CryptoCurrency): string {
  const d = DECIMALS[currency];
  const s = BigInt(base).toString().padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d)}`.replace(/\.?0+$/, "");
}

/** Amount due in base units: the USD price in USDC or SOL, plus a random tail that makes the quote unique. */
export function quoteBase(cents: number, currency: CryptoCurrency, solUsd: number | null, tail: number): bigint {
  if (currency === "USDC") return BigInt(cents) * BigInt(10_000) + BigInt(tail);
  if (!solUsd || solUsd <= 0) throw new Error("SOL price unavailable");
  // Round the SOL amount up to 0.0001 SOL, then add the tail (under 0.0001 SOL).
  const lamports = Math.ceil(((cents / 100 / solUsd) * 1e9) / 1e5) * 1e5;
  return BigInt(lamports) + BigInt(tail);
}

export function solanaPayUrl(p: Pick<CryptoPayment, "recipient" | "amount_base" | "currency" | "reference" | "plan_id" | "billing_interval" | "id">, planName: string): string {
  const q = new URLSearchParams({ amount: formatBase(p.amount_base, p.currency) });
  if (p.currency === "USDC") q.set("spl-token", USDC_MINT);
  q.set("reference", p.reference);
  q.set("label", "SOLME");
  q.set("message", `SOLME ${planName} · ${p.billing_interval === "year" ? "1 year" : "1 month"}`);
  q.set("memo", `SOLME-${p.id.slice(0, 8)}`);
  return `solana:${p.recipient}?${q.toString().replace(/\+/g, "%20")}`;
}

export async function createCryptoPayment(userId: string, planId: string, interval: Interval, currency: CryptoCurrency): Promise<CryptoPayment> {
  const recipient = cryptoRecipient();
  if (!recipient) throw new Error("Crypto payments are not configured");
  const plan = await getPlan(planId);
  if (!plan || !plan.is_active || plan.id === "free") throw new Error("This plan is not available");
  const cents = interval === "year" ? plan.price_annual_cents : plan.price_monthly_cents;
  if (cents <= 0) throw new Error("This plan has no price set");
  const solUsd = currency === "SOL" ? await solPriceUsd() : null;
  // An open quote with the same amount would make signature claims ambiguous: draw another tail.
  for (let attempt = 0; attempt < 5; attempt++) {
    const amount = quoteBase(cents, currency, solUsd, randomInt(1, currency === "USDC" ? 10_000 : 100_000));
    const clash = await queryOne("SELECT 1 FROM crypto_payments WHERE currency = $1 AND amount_base = $2 AND status = 'pending'", [currency, amount.toString()]);
    if (clash) continue;
    const row = await queryOne<CryptoPayment>(
      `INSERT INTO crypto_payments (user_id, plan_id, billing_interval, currency, amount_base, amount_usd_cents, recipient, reference, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9)) RETURNING *`,
      [userId, planId, interval, currency, amount.toString(), cents, recipient, base58(randomBytes(32)), QUOTE_MINUTES],
    );
    return row!;
  }
  throw new Error("Could not create a unique quote, try again");
}

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);

/** How much the transaction paid the quote's recipient, in base units of the quote's currency, and who signed it. */
export function paidTo(tx: RawTx, p: Pick<CryptoPayment, "recipient" | "currency">): { paid: bigint; payer: string | null } | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const payer = keys.length ? keyOf(keys[0]) : null;
  if (p.currency === "SOL") {
    const i = keys.findIndex((k) => keyOf(k) === p.recipient);
    if (i < 0) return { paid: BigInt(0), payer };
    return { paid: BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0), payer };
  }
  const sum = (bals: NonNullable<RawTx["meta"]>["preTokenBalances"]) =>
    (bals ?? []).filter((b) => b.owner === p.recipient && b.mint === USDC_MINT).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), BigInt(0));
  return { paid: sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances), payer };
}

/**
 * Whether `tx` pays quote `p`. With `exact` (a pasted signature, no reference to tie it to this quote) the amount must
 * match to the base unit; otherwise at least the amount is enough.
 */
export function paysQuote(tx: RawTx, p: Pick<CryptoPayment, "recipient" | "currency" | "amount_base" | "created_at">, exact: boolean): { payer: string | null } | null {
  if (!tx.blockTime || tx.blockTime < new Date(p.created_at).getTime() / 1000 - 60) return null;
  const r = paidTo(tx, p);
  if (!r) return null;
  const due = BigInt(p.amount_base);
  return (exact ? r.paid === due : r.paid >= due) ? { payer: r.payer } : null;
}

/** Looks for the quote's payment on-chain (by reference). Returns true once it is confirmed. */
export async function checkCryptoPayment(p: CryptoPayment): Promise<boolean> {
  if (p.status === "confirmed") return true;
  await query("UPDATE crypto_payments SET checked_at = now() WHERE id = $1", [p.id]);
  const sigs = await getSignatures(p.reference, { limit: 10 });
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await getRawTransaction(s.signature);
    const ok = tx && paysQuote(tx, p, false);
    if (ok && (await confirmCryptoPayment(p, s.signature, ok.payer))) return true;
  }
  return false;
}

/** A transfer sent without the reference (e.g. typed by hand): the user pastes its signature. */
export async function claimCryptoPayment(p: CryptoPayment, signature: string): Promise<"confirmed" | "not_found" | "no_match" | "used"> {
  if (p.status === "confirmed") return "confirmed";
  if (await queryOne("SELECT 1 FROM crypto_payments WHERE signature = $1", [signature])) return "used";
  const tx = await getRawTransaction(signature);
  if (!tx) return "not_found";
  const ok = paysQuote(tx, p, true);
  if (!ok) return "no_match";
  return (await confirmCryptoPayment(p, signature, ok.payer)) ? "confirmed" : "used";
}

/**
 * Marks the quote paid and adds its period to the user's crypto subscription, in one transaction. False when the
 * quote was already confirmed or the signature already paid another quote.
 */
export async function confirmCryptoPayment(p: CryptoPayment, signature: string, payer: string | null): Promise<boolean> {
  const plan = await getPlan(p.plan_id);
  if (!plan) return false;
  let result: { end: Date } | null = null;
  try {
    result = await transaction(async (tx) => {
      const [claimed] = await tx.query<{ id: string }>(
        `UPDATE crypto_payments SET status = 'confirmed', signature = $2, payer = $3, confirmed_at = now() WHERE id = $1 AND status <> 'confirmed' RETURNING id`,
        [p.id, signature, payer],
      );
      if (!claimed) return null;
      const days = PERIOD_DAYS[p.billing_interval];
      const open = await tx.query<{ id: string; plan_id: string; end: Date; sort: number; monthly: number }>(
        `SELECT s.id, s.plan_id, s.current_period_end AS end, sp.sort_order AS sort, sp.price_monthly_cents AS monthly
           FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
          WHERE s.user_id = $1 AND s.source = 'crypto' AND s.status = 'active' AND s.current_period_end > now()`,
        [p.user_id],
      );
      const same = open.find((s) => s.plan_id === p.plan_id);
      let subId: string;
      let end: Date;
      if (same) {
        // Renewal: the new period starts when the current one ends.
        [{ id: subId, end }] = await tx.query<{ id: string; end: Date }>(
          `UPDATE subscriptions SET current_period_end = current_period_end + make_interval(days => $2), billing_interval = $3, reminded_at = NULL, updated_at = now()
            WHERE id = $1 RETURNING id, current_period_end AS end`,
          [same.id, days, p.billing_interval],
        );
      } else {
        // Upgrade: a lower plan's remaining days become days on this plan at their value. A higher plan keeps running and
        // this one starts counting after it.
        let bonusDays = 0;
        let startAfter = Date.now();
        for (const s of open) {
          if (s.sort < plan.sort_order) {
            const left = (new Date(s.end).getTime() - Date.now()) / 86_400_000;
            if (plan.price_monthly_cents > 0) bonusDays += (left * s.monthly) / plan.price_monthly_cents;
            await tx.query("UPDATE subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now() WHERE id = $1", [s.id]);
          } else startAfter = Math.max(startAfter, new Date(s.end).getTime());
        }
        [{ id: subId, end }] = await tx.query<{ id: string; end: Date }>(
          `INSERT INTO subscriptions (user_id, plan_id, source, billing_interval, status, current_period_start, current_period_end)
           VALUES ($1, $2, 'crypto', $3, 'active', now(), to_timestamp($4) + make_interval(days => $5))
           RETURNING id, current_period_end AS end`,
          [p.user_id, p.plan_id, p.billing_interval, startAfter / 1000, days + Math.floor(bonusDays)],
        );
      }
      await tx.query("UPDATE crypto_payments SET subscription_id = $2 WHERE id = $1", [p.id, subId]);
      await tx.query(
        `INSERT INTO payment_events (provider, event_id, event_type, user_id, amount_cents, currency, payload, status, processed_at)
         VALUES ('solana', $1, 'crypto.paid', $2, $3, 'usd', $4, 'processed', now()) ON CONFLICT (provider, event_id) DO NOTHING`,
        [signature, p.user_id, p.amount_usd_cents, JSON.stringify({ paymentId: p.id, plan: p.plan_id, interval: p.billing_interval, currency: p.currency, amount: formatBase(p.amount_base, p.currency), payer })],
      );
      return { end };
    });
  } catch (err) {
    // The signature already paid another quote (UNIQUE): not a payment for this one.
    if (/duplicate key|unique/i.test(errorMessage(err))) return false;
    throw err;
  }
  if (!result) return false;
  log.info("Crypto payment confirmed", { payment: p.id, plan: p.plan_id, currency: p.currency, signature });
  await notifyUser(p.user_id, `Payment received: SOLME ${plan.name}`, `Thanks! ${formatBase(p.amount_base, p.currency)} ${p.currency} received. SOLME ${plan.name} is active until ${formatDateTime(result.end)}.`);
  return true;
}

async function notifyUser(userId: string, subject: string, text: string) {
  const u = await queryOne<{ email: string; chat: string | null }>(
    "SELECT u.email, p.telegram_chat_id AS chat FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1",
    [userId],
  );
  if (!u) return;
  await Promise.allSettled([
    sendEmail(u.email, subject, text),
    u.chat && env.telegramBotToken ? sendTelegram(u.chat, `${subject}\n\n${text}`) : Promise.resolve(),
  ]);
}

/** Worker job: checks open quotes (and recently expired ones, for late payments), then sends renewal reminders. */
export async function processCryptoPayments(): Promise<{ checked: number; confirmed: number; reminded: number }> {
  if (!cryptoConfigured()) return { checked: 0, confirmed: 0, reminded: 0 };
  await query(`UPDATE crypto_payments SET status = 'expired' WHERE status = 'pending' AND expires_at < now() - make_interval(hours => $1)`, [LATE_HOURS]);
  // Open quotes every run; expired ones every few minutes.
  const open = await query<CryptoPayment>(
    `SELECT * FROM crypto_payments
      WHERE status = 'pending'
        AND (checked_at IS NULL OR checked_at < now() - CASE WHEN expires_at > now() THEN interval '10 seconds' ELSE interval '5 minutes' END)
      ORDER BY expires_at DESC LIMIT 20`,
  );
  let confirmed = 0;
  for (const p of open) {
    try {
      if (await checkCryptoPayment(p)) confirmed++;
    } catch (err) {
      log.warn("Crypto payment check failed", { payment: p.id, error: errorMessage(err) });
    }
  }
  return { checked: open.length, confirmed, reminded: await sendRenewalReminders() };
}

async function sendRenewalReminders(): Promise<number> {
  const due = await query<{ id: string; user_id: string; name: string; end: Date }>(
    `SELECT s.id, s.user_id, sp.name, s.current_period_end AS end FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.source = 'crypto' AND s.status = 'active' AND s.reminded_at IS NULL
        AND s.current_period_end BETWEEN now() AND now() + make_interval(days => $1)`,
    [RENEW_REMIND_DAYS],
  );
  for (const s of due) {
    await query("UPDATE subscriptions SET reminded_at = now() WHERE id = $1", [s.id]);
    await notifyUser(
      s.user_id,
      `Your SOLME ${s.name} ends ${formatDateTime(s.end)}`,
      `Crypto plans don't renew automatically. Extend it with USDC or SOL at ${env.appUrl}/app/billing (the new period starts when this one ends, so you lose no days).`,
    );
  }
  return due.length;
}

/** What the checkout screen shows for a quote. */
export async function cryptoPaymentView(p: CryptoPayment) {
  const plan = await getPlan(p.plan_id);
  const url = solanaPayUrl(p, plan?.name ?? p.plan_id);
  return {
    id: p.id,
    status: p.status === "pending" && new Date(p.expires_at).getTime() < Date.now() ? ("expired" as const) : p.status,
    plan: plan?.name ?? p.plan_id,
    interval: p.billing_interval,
    currency: p.currency,
    amount: formatBase(p.amount_base, p.currency),
    usd: p.amount_usd_cents / 100,
    recipient: p.recipient,
    url,
    qr: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    expiresAt: new Date(p.expires_at).toISOString(),
    signature: p.signature,
  };
}
