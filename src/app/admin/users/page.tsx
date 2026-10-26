import type { Metadata } from "next";
import { AdminAction, GrantPlanForm } from "@/components/admin/admin-forms";
import { Pagination } from "@/components/app/pagination";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requirePageAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = q ? "WHERE lower(u.email) LIKE $1" : "";
  const params = q ? [`%${q.toLowerCase()}%`] : [];
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM users u ${where}`, params);
  const users = await query<{ id: string; email: string; role: string; status: string; email_verified_at: Date | null; created_at: Date; last_login_at: Date | null; plan: string | null; plan_source: string | null; plan_end: Date | null }>(
    `SELECT u.id, u.email, r.name AS role, u.status, u.email_verified_at, u.created_at, u.last_login_at, s.plan_id AS plan, s.source AS plan_source, s.current_period_end AS plan_end
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN LATERAL (SELECT plan_id, source, current_period_end FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()) ORDER BY updated_at DESC LIMIT 1) s ON true
       ${where} ORDER BY u.created_at DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
    params,
  );
  return (
    <>
      <PageHeader title="Users" description={`${n} accounts. All actions are audited.`} />
      <form className="mb-4 flex gap-2" role="search"><input name="q" defaultValue={q} placeholder="Search email" className="input h-9 max-w-xs" aria-label="Search users" /><button className="rounded-lg border border-line-strong px-3 text-sm">Search</button></form>
      <Card>
        <div className="divide-y divide-line">
          {users.map((u) => (
            <details key={u.id} className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[2fr_repeat(4,1fr)] items-center gap-3 px-4 py-2.5 text-sm hover:bg-ink-750 max-md:grid-cols-2">
                <span className="truncate font-medium">{u.email}</span>
                <span><Badge tone={u.role === "admin" ? "warn" : u.role === "support" ? "info" : "neutral"}>{u.role}</Badge></span>
                <span>{u.plan ? <Badge tone="ai">{u.plan}{u.plan_source === "admin_grant" ? " (grant)" : ""}</Badge> : <span className="text-xs text-fg-faint">free</span>}</span>
                <span>{u.status === "active" ? <Badge tone="up">active</Badge> : <Badge tone="down">disabled</Badge>} {!u.email_verified_at && <Badge tone="warn">unverified</Badge>}</span>
                <span className="text-xs text-fg-faint">joined {timeAgo(u.created_at)} · login {timeAgo(u.last_login_at)}</span>
              </summary>
              <div className="space-y-3 bg-ink-900/50 px-4 py-3">
                <p className="text-xs text-fg-faint">ID {u.id} · created {formatDateTime(u.created_at)}{u.plan_end ? ` · plan until ${formatDateTime(u.plan_end)}` : ""}</p>
                {u.id === admin.id ? <p className="text-xs text-warn">This is your account — role and status changes are disabled.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {(["user", "support", "admin"] as const).filter((r) => r !== u.role).map((r) => <AdminAction key={r} endpoint={`/api/admin/users/${u.id}`} body={{ action: "role", role: r }} label={`Make ${r}`} confirm={`Change role to ${r}?`} />)}
                    <AdminAction endpoint={`/api/admin/users/${u.id}`} body={{ action: "status", status: u.status === "active" ? "disabled" : "active" }} label={u.status === "active" ? "Disable" : "Enable"} confirm="Are you sure?" variant={u.status === "active" ? "danger" : "secondary"} />
                    {!u.email_verified_at && <AdminAction endpoint={`/api/admin/users/${u.id}`} body={{ action: "verify_email" }} label="Mark email verified" confirm="Confirm identity verified out-of-band?" />}
                    <AdminAction endpoint={`/api/admin/users/${u.id}`} body={{ action: "revoke_sessions" }} label="Sign out everywhere" confirm="Revoke all sessions?" />
                  </div>
                )}
                <GrantPlanForm userId={u.id} />
              </div>
            </details>
          ))}
        </div>
        <div className="border-t border-line"><Pagination base="/admin/users" params={sp} page={page} pageSize={25} total={n} /></div>
      </Card>
    </>
  );
}
