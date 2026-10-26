import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, cx, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query, queryOne } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Security & audit" };

const FILTERS: [string, string][] = [["", "All"], ["auth.", "Authentication"], ["admin.", "Admin actions"], ["billing.", "Billing"], ["account.", "Account"]];

export default async function AdminSecurity({ searchParams }: PageProps<"/admin/security">) {
  await requirePageAdmin();
  const sp = await searchParams;
  const prefix = typeof sp.f === "string" && FILTERS.some(([f]) => f === sp.f) ? sp.f : "";
  const [rows, failed] = await Promise.all([
    query<{ id: number; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; ip: string | null; created_at: Date; email: string | null }>(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.ip, a.created_at, u.email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.action LIKE $1 ORDER BY a.created_at DESC LIMIT 200`,
      [`${prefix}%`],
    ),
    queryOne<{ n: number; ips: number }>("SELECT count(*)::int AS n, count(DISTINCT ip)::int AS ips FROM audit_logs WHERE action = 'auth.login_failed' AND created_at > now() - interval '24 hours'"),
  ]);
  return (
    <>
      <PageHeader title="Security events & audit log" description="Append-only record of authentication events and sensitive changes." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Failed logins · 24h" value={failed?.n ?? 0} sub={`${failed?.ips ?? 0} distinct IPs`} tone={(failed?.n ?? 0) > 50 ? "warn" : undefined} />
      </div>
      <nav className="mb-3 flex gap-1" aria-label="Filter">{FILTERS.map(([f, l]) => <Link key={l} href={f ? `?f=${f}` : "?"} className={cx("rounded-md px-3 py-1 text-sm", prefix === f ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg")}>{l}</Link>)}</nav>
      <Card>
        <CardHeader title="Events" />
        {rows.length === 0 ? <EmptyState title="No events" /> : (
          <div className="overflow-x-auto"><table className="table-terminal">
            <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="text-xs">{formatDateTime(r.created_at)}</td>
                <td><Badge tone={r.action.includes("failed") ? "down" : r.action.startsWith("admin.") ? "warn" : "neutral"}>{r.action}</Badge></td>
                <td className="text-xs">{r.email ?? "system"}</td>
                <td className="num text-xs text-fg-faint">{r.target_type ? `${r.target_type}:${r.target_id?.slice(0, 8) ?? ""}` : ""}</td>
                <td className="num text-xs">{r.ip ?? ""}</td>
                <td className="max-w-md truncate text-xs text-fg-faint" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
