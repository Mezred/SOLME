import { z } from "zod";
import { checkCryptoPayment, claimCryptoPayment, cryptoPaymentView, type CryptoPayment } from "@/lib/billing/crypto";
import { isUuid, queryOne } from "@/lib/db";
import { api, badRequest, enforceRateLimit, notFound, ok, parseBody, requireUser } from "@/lib/http";
import { errorMessage, logger } from "@/lib/log";

const log = logger("crypto-billing");
type Ctx = { params: Promise<{ id: string }> };

async function load(userId: string, id: string) {
  if (!isUuid(id)) throw badRequest("Invalid id");
  const p = await queryOne<CryptoPayment>("SELECT * FROM crypto_payments WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!p) throw notFound("Payment not found");
  return p;
}

/** Quote status. While it is open, the checkout page polls this and each poll looks for the payment on-chain. */
export const GET = api<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  let p = await load(user.id, (await ctx.params).id);
  if (p.status === "pending") {
    try {
      await enforceRateLimit(`crypto-check:${user.id}`, 30, 60);
      if (await checkCryptoPayment(p)) p = await load(user.id, p.id);
    } catch (err) {
      // Rate limit or RPC hiccup: report the stored status; the worker keeps checking.
      log.warn("Crypto payment poll check skipped", { payment: p.id, error: errorMessage(err) });
    }
  }
  return ok(await cryptoPaymentView(p));
});

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** "I paid without the QR code": the user pastes the transaction signature; the amount must match exactly. */
export const POST = api<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  await enforceRateLimit(`crypto-claim:${user.id}`, 10, 600);
  const p = await load(user.id, (await ctx.params).id);
  const { signature } = await parseBody(req, z.object({ signature: z.string().trim().regex(SIGNATURE, "That is not a Solana transaction signature") }));
  const r = await claimCryptoPayment(p, signature);
  if (r === "not_found") throw badRequest("Transaction not found yet. Wait a few seconds after it confirms and try again.");
  if (r === "no_match") throw badRequest("That transaction doesn't pay this quote: it must send exactly the amount shown, to the address shown, after the quote was created.");
  if (r === "used") throw badRequest("That transaction was already used for a payment.");
  return ok(await cryptoPaymentView(await load(user.id, p.id)));
});
