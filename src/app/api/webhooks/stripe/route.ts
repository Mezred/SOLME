import { NextResponse } from "next/server";
import { processStripeEvent, type StripeEvent } from "@/lib/billing/webhooks";
import { verifyStripeSignature } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Stripe webhook endpoint. The raw body is verified before anything is parsed or trusted. */
export async function POST(req: Request) {
  if (!env.stripeWebhookSecret) return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), env.stripeWebhookSecret)) {
    logger("billing").warn("Rejected webhook with invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  try {
    const result = await processStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    // Non-2xx makes Stripe retry later; the event row records the failure.
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
