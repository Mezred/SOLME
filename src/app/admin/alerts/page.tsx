import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Alert delivery" };

export default async function AdminAlerts() {
  await requirePageAdmin();
  const [stats, failed, outbox] = await Promise.all([
    query<{ channel: string; status: string; n: number }>("SELECT channel, status, count(*)::int AS n FROM notifications WHERE created_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 1, 2"),
    query<{ id: string; email: string; channel: string; title: string; attempts: number; last_error: string | null; created_at: Date }>(
      "SELECT n.id, u.email, n.channel, n.title, n.attempts, n.last_error, n.created_at FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.status IN ('failed', 'pending') AND n.channel <> 'in_app' ORDER BY n.created_at DESC LIMIT 100",
    ),
    query<{ id: string; to_email: string; subject: string; status: string; error: string | null; created_at: Date }>("SELECT id, to_email, subject, status, error, created_at FROM email_outbox ORDER BY created_at DESC LIMIT 50"),
  ]);
  return (
    <>
      <PageHeader title="Alert delivery logs" />
      <Card><CardHeader title="Deliveries · 7 days" />{stats.length === 0 ? <EmptyState title="No notifications" /> : (
        <table className="table-terminal"><thead><tr><th>Channel</th><th>Status</th><th className="text-right">Count</th></tr></thead><tbody>{stats.map((s) => <tr key={`${s.channel}-${s.status}`}><td>{s.channel}</td><td><Badge tone={s.status === "failed" ? "down" : s.status === "pending" ? "warn" : "up"}>{s.status}</Badge></td><td className="num text-right">{s.n}</td></tr>)}</tbody></table>
      )}</Card>
      <Card className="mt-4"><CardHeader title="Pending & failed external deliveries" />{failed.length === 0 ? <EmptyState title="Nothing pending or failed" /> : (
        <div className="overflow-x-auto"><table className="table-terminal"><thead><tr><th>Created</th><th>User</th><th>Channel</th><th>Alert</th><th className="text-right">Attempts</th><th>Last error</th></tr></thead>
          <tbody>{failed.map((f) => <tr key={f.id}><td className="text-xs">{formatDateTime(f.created_at)}</td><td className="text-xs">{f.email}</td><td>{f.channel}</td><td>{f.title}</td><td className="num text-right">{f.attempts}</td><td className="max-w-xs truncate text-xs text-down">{f.last_error}</td></tr>)}</tbody></table></div>
      )}</Card>
      <Card className="mt-4"><CardHeader title="Email outbox" subtitle="'logged' = email provider not configured; message written to server logs only" />{outbox.length === 0 ? <EmptyState title="No emails" /> : (
        <div className="overflow-x-auto"><table className="table-terminal"><thead><tr><th>Created</th><th>To</th><th>Subject</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>{outbox.map((o) => <tr key={o.id}><td className="text-xs">{formatDateTime(o.created_at)}</td><td className="text-xs">{o.to_email}</td><td>{o.subject}</td><td><Badge tone={o.status === "sent" ? "up" : o.status === "failed" ? "down" : "neutral"}>{o.status}</Badge></td><td className="text-xs text-down">{o.error}</td></tr>)}</tbody></table></div>
      )}</Card>
    </>
  );
}
