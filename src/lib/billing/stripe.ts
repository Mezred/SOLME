import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/http";

/**
 * Minimal Stripe REST client (no SDK dependency). All calls are server-side with the secret key.
 * Docs: https://docs.stripe.com/api
 */
type Params = Record<string, string | number | boolean | null | undefined>;

function form(params: Params): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.append(k, String(v));
  return p.toString();
}

export function stripeConfigured() {
  return Boolean(env.stripeSecretKey && env.stripeWebhookSecret);
}

export async function stripe<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  if (!env.stripeSecretKey) throw new ApiError(503, "Billing is not configured on this server.", "billing_unconfigured");
  const qs = method === "GET" && Object.keys(params).length ? `?${form(params)}` : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: method === "GET" ? undefined : form(params),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new ApiError(res.status >= 500 ? 502 : 400, `Stripe: ${body.error?.message ?? `HTTP ${res.status}`}`, "stripe_error");
  return body;
}

/**
 * Verifies a Stripe-Signature header (v1 HMAC-SHA256 over "timestamp.payload") with a timestamp tolerance
 * to block replays. Returns false on any mismatch; uses constant-time comparison.
 */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { id: string; price: { id: string; recurring?: { interval?: string } }; current_period_start?: number; current_period_end?: number }[] };
}
