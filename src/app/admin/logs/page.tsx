import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Errors & jobs" };

export default async function AdminLogs({ searchParams }: PageProps<"/admin/logs">) {
  await requirePageAdmin();
  const sp = await searchParams;
  const level = sp.level === "warn" ? "warn" : "error";
  const [logs, jobs] = await Promise.all([
    query<{ id: number; level: string; source: string; message: string; context: Record<string, unknown>; created_at: Date }>(
      "SELECT id, level, source, message, context, created_at FROM app_logs WHERE level = $1 ORDER BY created_at DESC LIMIT 150",
      [level],
    ),
    query<{ id: number; type: string; status: string; attempts: number; last_error: string | null; run_at: Date; created_at: Date }>(
      "SELECT id, type, status, attempts, last_error, run_at, created_at FROM jobs WHERE status IN ('failed', 'running') OR (status = 'queued' AND attempts > 0) ORDER BY created_at DESC LIMIT 100",
    ),
  ]);
  return (
    <>
      <PageHeader title="Errors & background jobs" description="Structured server logs (warn/error persist here; all levels go to stdout as JSON)." actions={<div className="flex gap-2 text-sm"><a href="?level=error" className={level === "error" ? "text-fg" : "text-fg-muted"}>Errors</a><a href="?level=warn" className={level === "warn" ? "text-fg" : "text-fg-muted"}>Warnings</a></div>} />
      <Card><CardHeader title={`Recent ${level}s`} />{logs.length === 0 ? <EmptyState title={`No ${level}s logged`} /> : (
        <ul className="divide-y divide-line">{logs.map((l) => (
          <li key={l.id} className="px-4 py-2 text-sm">
            <div className="flex items-center gap-2"><Badge tone={l.level === "error" ? "down" : "warn"}>{l.source}</Badge><span className="font-medium">{l.message}</span><span className="ml-auto text-xs text-fg-faint">{formatDateTime(l.created_at)}</span></div>
            {Object.keys(l.context).length > 0 && <pre className="num mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-fg-faint">{JSON.stringify(l.context)}</pre>}
          </li>
        ))}</ul>
      )}</Card>
      <Card className="mt-4"><CardHeader title="Problem jobs" />{jobs.length === 0 ? <EmptyState title="No failed or retrying jobs" /> : (
        <table className="table-terminal"><thead><tr><th>ID</th><th>Type</th><th>Status</th><th className="text-right">Attempts</th><th>Next run</th><th>Last error</th></tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id}><td className="num">{j.id}</td><td>{j.type}</td><td><Badge tone={j.status === "failed" ? "down" : "warn"}>{j.status}</Badge></td><td className="num text-right">{j.attempts}</td><td className="text-xs">{formatDateTime(j.run_at)}</td><td className="max-w-md truncate text-xs text-down" title={j.last_error ?? undefined}>{j.last_error}</td></tr>)}</tbody></table>
      )}</Card>
    </>
  );
}
