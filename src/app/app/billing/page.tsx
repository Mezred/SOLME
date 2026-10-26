import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingActions } from "@/components/app/billing-actions";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements, PAST_DUE_GRACE_DAYS } from "@/lib/billing/entitlements";
import { featureRows, listPlans } from "@/lib/billing/plans";
import { stripeConfigured } from "@/lib/billing/stripe";
import { query } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Subscription & Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/app/billing">) {
  const user = await requirePageUser("/app/billing");
  const sp = await searchParams;
  const [ent, plans, history] = await Promise.all([
    getEntitlements(user.id),
    listPlans(),
    query<{ event_type: string; amount_cents: number | null; currency: string | null; received_at: Date; status: string }>(
      `SELECT event_type, amount_cents, currency, received_at, status FROM payment_events
        WHERE user_id = $1 AND event_type IN ('invoice.paid', 'invoice.payment_failed') ORDER BY received_at DESC LIMIT 50`,
      [user.id],
    ),
  ]);
  const sub = ent.subscription;
  const hasStripeSub = sub?.source === "stripe";
  const current = plans.find((p) => p.id === ent.planId)!;

  return (
    <>
      <PageHeader title="Subscription & Billing" description="Plans are enforced on the server from your verified subscription. Payments are processed by Stripe; NEXALPHA never sees your card details." />
      {sp.checkout === "success" && <div className="mb-4"><Notice tone="info" title="Checkout complete">Your plan activates as soon as Stripe confirms the payment (usually a few seconds). Refresh if it hasn&apos;t updated yet.</Notice></div>}
      {sp.checkout === "cancelled" && <div className="mb-4"><Notice tone="warn">Checkout was cancelled — you have not been charged.</Notice></div>}
      {ent.inGracePeriod && <div className="mb-4"><Notice tone="down" title="Payment failed">Your last renewal failed. Access continues for up to {PAST_DUE_GRACE_DAYS} days while Stripe retries — update your payment method to avoid losing paid features.</Notice></div>}
      {!user.emailVerified && <div className="mb-4"><Notice tone="warn">Verify your email address before subscribing.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Current plan" action={<Badge tone={ent.planId === "free" ? "neutral" : "ai"}>{ent.planName}</Badge>} />
          <div className="space-y-2 px-4 py-3 text-sm">
            {sub ? (
              <dl className="grid grid-cols-2 gap-y-1.5">
                <dt className="text-fg-faint">Status</dt><dd><Badge tone={sub.status === "active" || sub.status === "trialing" ? "up" : "warn"}>{sub.status}</Badge></dd>
                <dt className="text-fg-faint">Source</dt><dd>{sub.source === "admin_grant" ? "Granted by support" : "Stripe"}</dd>
                <dt className="text-fg-faint">Billing</dt><dd>{sub.interval ? (sub.interval === "year" ? "Annual" : "Monthly") : "—"}</dd>
                <dt className="text-fg-faint">{sub.cancelAtPeriodEnd ? "Ends" : "Renews / ends"}</dt><dd>{formatDateTime(sub.currentPeriodEnd)}</dd>
              </dl>
            ) : (
              <p className="text-fg-muted">You are on the Free plan.</p>
            )}
            {sub?.cancelAtPeriodEnd && <Notice tone="warn">Cancellation scheduled — you keep {ent.planName} until {formatDateTime(sub.currentPeriodEnd)}.</Notice>}
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-fg-muted">
              {featureRows(current.features).map((r) => <li key={r}>• {r}</li>)}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title={hasStripeSub ? "Change plan" : "Upgrade"} subtitle="Upgrades are prorated; downgrades take effect immediately with credit applied to future invoices." />
          <div className="p-4">
            <Suspense>
              <BillingActions
                configured={stripeConfigured()}
                currentPlan={ent.planId}
                hasStripeSub={hasStripeSub}
                cancelAtPeriodEnd={Boolean(sub?.cancelAtPeriodEnd)}
                plans={plans.map((p) => ({ id: p.id, name: p.name, monthly: p.price_monthly_cents, annual: p.price_annual_cents, purchasable: { month: Boolean(p.stripe_price_monthly), year: Boolean(p.stripe_price_annual) } }))}
              />
            </Suspense>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Billing history" subtitle="Recorded from verified Stripe webhooks. Full invoices are available in the Stripe customer portal." />
        {history.length === 0 ? <EmptyState title="No payments yet" /> : (
          <table className="table-terminal">
            <thead><tr><th>Date</th><th>Event</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{formatDateTime(h.received_at)}</td>
                  <td>{h.event_type === "invoice.paid" ? <Badge tone="up">Paid</Badge> : <Badge tone="down">Payment failed</Badge>}</td>
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
