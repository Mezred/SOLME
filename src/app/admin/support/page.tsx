import type { Metadata } from "next";
import Link from "next/link";
import { SupportTicketForm } from "@/components/admin/admin-forms";
import { Badge, Card, cx, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Support" };

export default async function AdminSupport({ searchParams }: PageProps<"/admin/support">) {
  const user = await requirePageUser("/admin/support");
  if (user.role !== "admin" && user.role !== "support") redirect("/app");
  const sp = await searchParams;
  const status = sp.status === "pending" || sp.status === "closed" ? sp.status : "open";
  const tickets = await query<{ id: string; email: string; subject: string; message: string; priority: string; status: string; admin_note: string | null; created_at: Date }>(
    "SELECT id, email, subject, message, priority, status, admin_note, created_at FROM support_tickets WHERE status = $1 ORDER BY (priority = 'priority') DESC, created_at LIMIT 100",
    [status],
  );
  return (
    <>
      <PageHeader title="Support tickets" description="Submitted from the public contact form. Elite customers are flagged as priority." />
      <nav className="mb-3 flex gap-1" aria-label="Status">{["open", "pending", "closed"].map((s) => <Link key={s} href={`?status=${s}`} className={cx("rounded-md px-3 py-1 text-sm capitalize", status === s ? "bg-ink-700 text-fg" : "text-fg-muted")}>{s}</Link>)}</nav>
      <Card>
        {tickets.length === 0 ? <EmptyState title={`No ${status} tickets`} /> : (
          <ul className="divide-y divide-line">{tickets.map((t) => (
            <li key={t.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{t.subject}</span>{t.priority === "priority" && <Badge tone="warn">priority</Badge>}<span className="text-xs text-fg-faint">{t.email} · {formatDateTime(t.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{t.message}</p>
              <SupportTicketForm id={t.id} status={t.status} note={t.admin_note} />
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
