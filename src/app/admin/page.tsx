import type { Metadata } from "next";
import { BULLISH_ELIGIBLE_SQL } from "@/lib/scoring/stored";
import Link from "next/link";
import { AdminAction } from "@/components/admin/admin-forms";
import { Badge, Card, CardHeader, Notice, PageHeader, Stat } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query, queryOne } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { lastIngestion } from "@/lib/data/tokens";
import { listProviderStatus } from "@/lib/providers/health";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverview() {
  await requirePageAdmin();
  const [users, subs, scored, jobs, errors, ing, providers, tickets] = await Promise.all([
    queryOne<{ total: number; d7: number; verified: number }>("SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS d7, count(email_verified_at)::int AS verified FROM users"),
    query<{ plan_id: string; n: number }>("SELECT plan_id, count(*)::int AS n FROM subscriptions WHERE status IN ('active', 'trialing', 'past_due') AND (current_period_end IS NULL OR current_period_end > now()) GROUP BY plan_id"),
    queryOne<{ scored: number; bullish: number }>(
      `SELECT count(*)::int AS scored, count(*) FILTER (WHERE ${BULLISH_ELIGIBLE_SQL})::int AS bullish FROM token_assets t
        WHERE t.is_demo = $1 AND (t.metadata->'last_score'->>'at')::timestamptz > now() - interval '2 hours'`,
      [env.demoMode],
    ),
    queryOne<{ queued: number; failed: number }>("SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS failed FROM jobs"),
    queryOne<{ n: number }>("SELECT count(*)::int AS n FROM app_logs WHERE level = 'error' AND created_at > now() - interval '24 hours'"),
    lastIngestion(),
    listProviderStatus(),
    queryOne<{ n: number }>("SELECT count(*)::int AS n FROM support_tickets WHERE status = 'open'"),
  ]);
  return (
    <>
      <PageHeader title="Admin overview" description={`Database: ${integrations.database}${env.demoMode ? " · DEMO MODE" : ""}`} actions={<AdminAction endpoint="/api/admin/ingest" method="POST" label="Run ingestion now" confirm="Queue a cycle?" variant="primary" />} />
      {env.demoMode && <div className="mb-4"><Notice tone="warn">DEMO_MODE is on — the engine serves synthetic data only.</Notice></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={users?.total ?? 0} sub={`${users?.d7 ?? 0} new in 7d · ${users?.verified ?? 0} verified`} />
        <Stat label="Paid subscriptions" value={subs.reduce((s, x) => s + (x.plan_id === "free" ? 0 : x.n), 0)} sub={subs.map((s) => `${s.plan_id}: ${s.n}`).join(" · ") || "none"} />
        <Stat label="Scored · 2h" value={scored?.scored ?? 0} sub={`${scored?.bullish ?? 0} eligible bullish`} />
        <Stat label="Last ingestion" value={ing?.value.finishedAt ? timeAgo(ing.value.finishedAt) : "never"} sub={ing ? `${ing.value.stored} stored · ${ing.value.errors?.length ?? 0} errors` : undefined} tone={ing?.value.finishedAt && Date.now() - new Date(ing.value.finishedAt).getTime() > 15 * 60_000 ? "warn" : undefined} />
        <Stat label="Jobs" value={jobs?.queued ?? 0} sub={`${jobs?.failed ?? 0} failed in 24h`} tone={jobs?.failed ? "warn" : undefined} />
        <Stat label="Errors 24h" value={errors?.n ?? 0} tone={errors?.n ? "down" : undefined} />
        <Stat label="Open tickets" value={tickets?.n ?? 0} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Provider health" action={<Link href="/admin/providers" className="text-xs text-up">Details</Link>} />
        <div className="flex flex-wrap gap-2 p-4">
          {providers.map((p) => (
            <Badge key={p.provider} tone={p.status === "healthy" ? "up" : p.status === "degraded" ? "warn" : p.status === "down" ? "down" : "neutral"}>{p.provider}: {p.status}</Badge>
          ))}
        </div>
      </Card>
    </>
  );
}
