import type { Metadata } from "next";
import Link from "next/link";
import { AdminAction } from "@/components/admin/admin-forms";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, PageHeader, SignalTypeBadge, Stat } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { lastIngestion } from "@/lib/data/tokens";
import { formatDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Signal feed" };

export default async function AdminSignals() {
  await requirePageAdmin();
  const [ing, recent, perHour, coverage] = await Promise.all([
    lastIngestion(),
    query<{ id: string; created_at: Date; chain: string; symbol: string; token_id: string; signal_type: string; ai_score: number; confidence_score: number; risk_score: number; status: string }>(
      `SELECT s.id, s.created_at, s.chain, t.symbol, s.token_id, s.signal_type, s.ai_score, s.confidence_score, s.risk_score, s.status
         FROM signals s JOIN token_assets t ON t.id = s.token_id WHERE s.is_demo = $1 ORDER BY s.created_at DESC LIMIT 50`,
      [env.demoMode],
    ),
    query<{ hour: string; n: number }>(
      "SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24:00') AS hour, count(*)::int AS n FROM signals WHERE created_at > now() - interval '24 hours' AND is_demo = $1 GROUP BY 1 ORDER BY 1 DESC",
      [env.demoMode],
    ),
    query<{ chain: string; tokens: number; spam: number; checked: number }>(
      `SELECT t.chain, count(*)::int AS tokens, count(*) FILTER (WHERE t.is_spam)::int AS spam,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM token_security_checks c WHERE c.token_id = t.id))::int AS checked
         FROM token_assets t WHERE t.is_demo = $1 AND t.updated_at > now() - interval '24 hours' GROUP BY t.chain ORDER BY t.chain`,
      [env.demoMode],
    ),
  ]);
  const v = ing?.value;
  return (
    <>
      <PageHeader title="Signal feed monitoring" actions={<AdminAction endpoint="/api/admin/ingest" method="POST" label="Run ingestion now" confirm="Queue a cycle?" variant="primary" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Last cycle" value={v?.finishedAt ? timeAgo(v.finishedAt) : "never"} />
        <Stat label="Candidates" value={v?.candidates ?? 0} />
        <Stat label="Stored" value={v?.stored ?? 0} sub={`${v?.spam ?? 0} flagged as spam`} />
        <Stat label="Security checks" value={v?.securityChecked ?? 0} />
        <Stat label="New signals" value={v?.signalsCreated ?? 0} />
      </div>
      {v?.errors?.length ? (
        <Card className="mt-4"><CardHeader title="Errors in last cycle" /><ul className="space-y-1 p-4 text-xs text-down">{v.errors.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul></Card>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader title="Latest signals" />
          {recent.length === 0 ? <EmptyState title="No signals" /> : (
            <div className="overflow-x-auto"><table className="table-terminal">
              <thead><tr><th>Time</th><th>Token</th><th>Type</th><th className="text-right">Score</th><th className="text-right">Conf</th><th className="text-right">Risk</th><th>Status</th></tr></thead>
              <tbody>{recent.map((s) => (
                <tr key={s.id}><td className="text-xs">{formatDateTime(s.created_at)}</td><td><Link href={`/app/token/${s.chain}/${s.token_id}?signal=${s.id}`} className="flex items-center gap-1.5 hover:text-up">{s.symbol}<ChainBadge chain={s.chain} /></Link></td><td><SignalTypeBadge type={s.signal_type} /></td><td className="num text-right">{s.ai_score}</td><td className="num text-right">{s.confidence_score}</td><td className="num text-right">{s.risk_score}</td><td><Badge>{s.status}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <div className="space-y-4">
          <Card><CardHeader title="Signals per hour (24h)" /><table className="table-terminal"><tbody>{perHour.map((h) => <tr key={h.hour}><td className="num text-xs">{h.hour}</td><td className="num text-right">{h.n}</td></tr>)}</tbody></table></Card>
          <Card><CardHeader title="Coverage (24h)" /><table className="table-terminal"><thead><tr><th>Chain</th><th className="text-right">Tokens</th><th className="text-right">Spam</th><th className="text-right">Checked</th></tr></thead><tbody>{coverage.map((c) => <tr key={c.chain}><td><ChainBadge chain={c.chain} /></td><td className="num text-right">{c.tokens}</td><td className="num text-right">{c.spam}</td><td className="num text-right">{c.checked}</td></tr>)}</tbody></table></Card>
        </div>
      </div>
    </>
  );
}
