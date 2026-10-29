import { z } from "zod";
import { createCryptoPayment, cryptoConfigured, cryptoPaymentView } from "@/lib/billing/crypto";
import { api, badRequest, enforceRateLimit, ok, parseBody, requireUser } from "@/lib/http";
import { errorMessage } from "@/lib/log";

const schema = z.object({ planId: z.enum(["pro", "elite"]), interval: z.enum(["month", "year"]), currency: z.enum(["USDC", "SOL"]) });

/**
 * Starts a crypto checkout: a Solana Pay quote valid for 30 minutes. Nothing is unlocked here; access changes only
 * once the payment is found and checked on-chain (see src/lib/billing/crypto.ts).
 */
export const POST = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`crypto-checkout:${user.id}`, 10, 600);
  if (!cryptoConfigured()) throw badRequest("Crypto payments are not set up on this deployment.");
  if (!user.emailVerified) throw badRequest("Verify your email address before subscribing.");
  const { planId, interval, currency } = await parseBody(req, schema);
  try {
    return ok(await cryptoPaymentView(await createCryptoPayment(user.id, planId, interval, currency)), { status: 201 });
  } catch (err) {
    throw badRequest(errorMessage(err));
  }
});
