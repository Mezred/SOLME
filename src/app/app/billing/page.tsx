import type { Metadata } from "next";
import { CryptoCheckout } from "@/components/app/crypto-checkout";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { featureRows, listPlans } from "@/lib/billing/plans";
import { cryptoConfigured, cryptoPaymentView, type CryptoPayment } from "@/lib/billing/crypto";
import { query, queryOne } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Subscription & Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/app/billing">) {
  const user = await requirePageUser("/app/billing");
  const sp = await searchParams;
  const [ent, plans, history, openQuote] = await Promise.all([
    getEntitlements(user.id),
    listPlans(),
    query<{ event_type: string; amount_cents: number | null; currency: string | null; received_at: Date }>(
      `SELECT event_type, amount_cents, currency, received_at FROM payment_events
        WHERE user_id = $1 AND event_type IN ('invoice.paid', 'crypto.paid') ORDER BY received_at DESC LIMIT 50`,
      [user.id],
    ),
    // A crypto quote still open (e.g. after a reload) is resumed instead of starting over.
    queryOne<CryptoPayment>("SELECT * FROM crypto_payments WHERE user_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at DESC LIMIT 1", [user.id]),
  ]);
  const crypto = cryptoConfigured();
  const resume = crypto && openQuote ? await cryptoPaymentView(openQuote) : null;
  const sub = ent.subscription;
  const hasCryptoSub = sub?.source === "crypto";
  const planOptions = plans.map((p) => ({ id: p.id, name: p.name, monthly: p.price_monthly_cents, annual: p.price_annual_cents }));
  const current = plans.find((p) => p.id === ent.planId)!;
  // Coming from the pricing page with ?plan=pro&interval=year: that plan and period are preselected.
  const suggested = sp.plan === "pro" || sp.plan === "elite" ? sp.plan : null;

  return (
    <>
      <PageHeader title="Subscription & Billing" description="Pay with USDC or SOL on Solana. Plans are prepaid, never renew on their own, and are enforced on the server from your on-chain payment." />
      {!user.emailVerified && <div className="mb-4"><Notice tone="warn">Verify your email address before subscribing.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Current plan" action={<Badge tone={ent.planId === "free" ? "neutral" : "ai"}>{ent.planName}</Badge>} />
          <div className="space-y-2 px-4 py-3 text-sm">
            {sub ? (
              <dl className="grid grid-cols-2 gap-y-1.5">
                <dt className="text-fg-faint">Status</dt><dd><Badge tone={sub.status === "active" || sub.status === "trialing" ? "up" : "warn"}>{sub.status}</Badge></dd>
                <dt className="text-fg-faint">Source</dt><dd>{sub.source === "admin_grant" ? "Granted by support" : "Crypto (prepaid)"}</dd>
                <dt className="text-fg-faint">Period</dt><dd>{sub.interval ? (sub.interval === "year" ? "1 year" : "1 month") : "—"}</dd>
                <dt className="text-fg-faint">{hasCryptoSub ? "Paid until" : "Ends"}</dt><dd>{formatDateTime(sub.currentPeriodEnd)}</dd>
              </dl>
            ) : (
              <p className="text-fg-muted">You are on the Free plan.</p>
            )}
            {hasCryptoSub && <p className="text-xs text-fg-faint">Nothing renews automatically. You get a reminder 3 days before it ends; if you don&apos;t pay again, you return to Free.</p>}
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-fg-muted">
              {featureRows(current.features).map((r) => <li key={r}>• {r}</li>)}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title={hasCryptoSub ? "Extend or upgrade" : "Upgrade"} subtitle="USDC or SOL on Solana, via Solana Pay. Confirmed on-chain in seconds." />
          <div className="p-4">
            {crypto ? (
              <CryptoCheckout
                plans={planOptions}
                currentPlan={ent.planId}
                extending={hasCryptoSub}
                resume={resume}
                suggested={suggested}
                initialPeriod={sp.interval === "year" ? "year" : "month"}
              />
            ) : (
              <Notice tone="warn" title="Payments are not set up">This deployment has no Solana Pay recipient configured, so paid plans cannot be bought yet. Administrators can grant plans manually (audited) from the admin panel.</Notice>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Billing history" subtitle="Every payment is confirmed on-chain before it unlocks anything." />
        {history.length === 0 ? <EmptyState title="No payments yet" /> : (
          <table className="table-terminal">
            <thead><tr><th>Date</th><th>Event</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{formatDateTime(h.received_at)}</td>
                  <td><Badge tone="up">{h.event_type === "crypto.paid" ? "Paid (crypto)" : "Paid (card, legacy)"}</Badge></td>
                  <td className="num text-right">{h.amount_cents !== null ? formatCents(h.amount_cents, h.currency ?? "usd") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
