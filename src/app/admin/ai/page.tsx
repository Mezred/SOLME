import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { aiCostSummary } from "@/lib/ai/chat";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { env, integrations } from "@/lib/env";

export const metadata: Metadata = { title: "AI usage" };

export default async function AdminAi() {
  await requirePageAdmin();
  const [days, top] = await Promise.all([
    aiCostSummary(30),
    query<{ email: string; requests: number; cost: number | null }>(
      `SELECT u.email, count(*)::int AS requests, sum(m.cost_usd) AS cost FROM ai_messages m JOIN users u ON u.id = m.user_id
        WHERE m.role = 'assistant' AND m.created_at > now() - interval '30 days' GROUP BY u.email ORDER BY cost DESC NULLS LAST LIMIT 20`,
    ),
  ]);
  const total = days.reduce((s, d) => s + Number(d.cost_usd), 0);
  return (
    <>
      <PageHeader title="AI requests & cost" description={`Model: ${env.aiModel} · effort ${env.aiEffort} · priced at $${env.aiInputPricePerMTok}/$${env.aiOutputPricePerMTok} per MTok (input/output, configurable).`} />
      {!integrations.ai && <div className="mb-4"><Notice tone="warn">ANTHROPIC_API_KEY is not set — AI features are disabled.</Notice></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Cost · 30 days" value={`$${total.toFixed(2)}`} />
        <Stat label="Replies · 30 days" value={days.reduce((s, d) => s + d.requests, 0)} />
        <Stat label="Avg cost / reply" value={`$${(total / Math.max(1, days.reduce((s, d) => s + d.requests, 0))).toFixed(4)}`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Daily" />{days.length === 0 ? <EmptyState title="No AI usage yet" /> : (
          <table className="table-terminal"><thead><tr><th>Day</th><th className="text-right">Replies</th><th className="text-right">Users</th><th className="text-right">In tok</th><th className="text-right">Out tok</th><th className="text-right">Cost</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.day}><td className="num">{d.day}</td><td className="num text-right">{d.requests}</td><td className="num text-right">{d.users}</td><td className="num text-right">{d.input_tokens}</td><td className="num text-right">{d.output_tokens}</td><td className="num text-right">${Number(d.cost_usd).toFixed(3)}</td></tr>)}</tbody></table>
        )}</Card>
        <Card><CardHeader title="Top users · 30 days" />{top.length === 0 ? <EmptyState title="No usage" /> : (
          <table className="table-terminal"><tbody>{top.map((t) => <tr key={t.email}><td>{t.email}</td><td className="num text-right">{t.requests}</td><td className="num text-right">${(t.cost ?? 0).toFixed(3)}</td></tr>)}</tbody></table>
        )}</Card>
      </div>
    </>
  );
}
