import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { stripeConfigured } from "@/lib/billing/stripe";
import { query } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function AdminSubscriptions() {
  await requirePageAdmin();
  const [subs, events, mrr] = await Promise.all([
    query<{ id: string; email: string; plan_id: string; source: string; status: string; billing_interval: string | null; current_period_end: Date | null; cancel_at_period_end: boolean; provider_subscription_id: string | null; updated_at: Date }>(
      `SELECT s.id, u.email, s.plan_id, s.source, s.status, s.billing_interval, s.current_period_end, s.cancel_at_period_end, s.provider_subscription_id, s.updated_at
         FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT 100`,
    ),
    query<{ event_id: string; event_type: string; status: string; error: string | null; amount_cents: number | null; currency: string | null; received_at: Date; email: string | null }>(
      `SELECT e.event_id, e.event_type, e.status, e.error, e.amount_cents, e.currency, e.received_at, u.email FROM payment_events e
         LEFT JOIN users u ON u.id = e.user_id ORDER BY e.received_at DESC LIMIT 100`,
    ),
    query<{ cents: number | null }>(
      `SELECT sum(CASE WHEN s.billing_interval = 'year' THEN p.price_annual_cents / 12.0 ELSE p.price_monthly_cents END)::int AS cents
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.source IN ('stripe', 'crypto') AND s.status IN ('active', 'trialing') AND s.current_period_end > now()`,
    ),
  ]);
  return (
    <>
      <PageHeader title="Subscriptions & payments" description={`Estimated MRR at list prices: ${formatCents(mrr[0]?.cents ?? 0)} (excludes discounts, taxes and admin grants).`} />
      {!stripeConfigured() && <div className="mb-4"><Notice tone="warn">Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).</Notice></div>}
      <Card>
        <CardHeader title="Subscriptions" />
        {subs.length === 0 ? <EmptyState title="No subscriptions" /> : (
          <div className="overflow-x-auto"><table className="table-terminal">
            <thead><tr><th>User</th><th>Plan</th><th>Source</th><th>Status</th><th>Interval</th><th>Period end</th><th>Stripe ID</th><th>Updated</th></tr></thead>
            <tbody>{subs.map((s) => (
              <tr key={s.id}><td>{s.email}</td><td><Badge tone="ai">{s.plan_id}</Badge></td><td>{s.source}</td><td><Badge tone={s.status === "active" ? "up" : s.status === "past_due" ? "warn" : "neutral"}>{s.status}</Badge>{s.cancel_at_period_end && <Badge tone="warn">cancels</Badge>}</td><td>{s.billing_interval ?? "—"}</td><td className="text-xs">{formatDateTime(s.current_period_end)}</td><td className="num text-xs text-fg-faint">{s.provider_subscription_id ?? "—"}</td><td className="text-xs">{formatDateTime(s.updated_at)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="Payment events (verified webhooks)" subtitle="Failed events are retried by Stripe; errors show why processing stopped." />
        {events.length === 0 ? <EmptyState title="No webhook events received" /> : (
          <div className="overflow-x-auto"><table className="table-terminal">
            <thead><tr><th>Received</th><th>Event</th><th>User</th><th className="text-right">Amount</th><th>Status</th><th>Error</th></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.event_id}><td className="text-xs">{formatDateTime(e.received_at)}</td><td className="num text-xs">{e.event_type}</td><td className="text-xs">{e.email ?? "—"}</td><td className="num text-right">{e.amount_cents !== null ? formatCents(e.amount_cents, e.currency ?? "usd") : "—"}</td><td><Badge tone={e.status === "processed" ? "up" : e.status === "failed" ? "down" : "neutral"}>{e.status}</Badge></td><td className="max-w-xs truncate text-xs text-down" title={e.error ?? undefined}>{e.error ?? ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
