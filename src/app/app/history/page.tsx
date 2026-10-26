import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/app/pagination";
import { flatParams } from "@/components/app/url";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, PriceChange, SignalTypeBadge, StrengthBadge, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query } from "@/lib/db";
import { listSignals, outcomeStats, signalFilterSchema } from "@/lib/data/signals";
import { formatDateTime, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Signal History" };

export default async function HistoryPage({ searchParams }: PageProps<"/app/history">) {
  const user = await requirePageUser("/app/history");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const filters = signalFilterSchema.parse({ ...flatParams(sp), status: "all" });
  const [stats, page] = await Promise.all([outcomeStats(ent.features.signal_history_days), listSignals(filters, ent, { historyMode: true })]);
  const outcomes = page.rows.length
    ? await query<{ signal_id: string; return_1h: number | null; return_6h: number | null; return_24h: number | null; hit_take_profit: boolean | null; hit_invalidation: boolean | null }>(
        "SELECT signal_id, return_1h, return_6h, return_24h, hit_take_profit, hit_invalidation FROM signal_history WHERE signal_id = ANY($1)",
        [page.rows.map((r) => r.id)],
      )
    : [];
  const byId = new Map(outcomes.map((o) => [o.signal_id, o]));

  return (
    <>
      <PageHeader title="Signal History" description={`Every signal from the last ${ent.features.signal_history_days} day(s) on your plan, with outcomes measured from NEXALPHA's own later snapshots.`} />
      <div className="mb-4">
        <Notice tone="warn" title="How to read these numbers">
          Returns are measured from the price at signal time to the first snapshot ~1h/6h/24h later. They ignore fees, slippage and execution, and only cover tokens the engine kept observing. Past outcomes do not predict future results.
        </Notice>
      </div>
      <Card className="mb-4">
        <CardHeader title="Measured outcomes by signal type" />
        {stats.length === 0 ? <EmptyState title="No signals in this window yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead><tr><th>Type</th><th className="text-right">Signals</th><th className="text-right">Measured (24h)</th><th className="text-right">Avg 24h</th><th className="text-right">Median 24h</th><th className="text-right">Positive 24h</th><th className="text-right">Reached TP1</th><th className="text-right">Hit invalidation</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.signal_type}>
                    <td><SignalTypeBadge type={s.signal_type} /></td>
                    <td className="num text-right">{s.n}</td>
                    <td className="num text-right">{s.measured}</td>
                    <td className="text-right"><PriceChange value={s.avg_return_24h} /></td>
                    <td className="text-right"><PriceChange value={s.median_return_24h} /></td>
                    <td className="num text-right">{s.positive_pct === null ? "—" : `${s.positive_pct.toFixed(0)}%`}</td>
                    <td className="num text-right">{s.tp_hit_pct === null ? "—" : `${s.tp_hit_pct.toFixed(0)}%`}</td>
                    <td className="num text-right">{s.invalidated_pct === null ? "—" : `${s.invalidated_pct.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-fg-faint">Distribution and high-risk signals are warnings: a negative return there means the warning was borne out.</p>
      </Card>
      <Card>
        <CardHeader title="All signals" />
        {page.rows.length === 0 ? <EmptyState title="No signals yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead><tr><th>Time</th><th>Token</th><th>Type</th><th>Strength</th><th className="text-right">Score</th><th className="text-right">Price then</th><th className="text-right">+1h</th><th className="text-right">+6h</th><th className="text-right">+24h</th><th>Levels</th><th>Status</th></tr></thead>
              <tbody>
                {page.rows.map((r) => {
                  const o = byId.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td className="text-xs">{formatDateTime(r.created_at)}</td>
                      <td><Link href={`/app/token/${r.chain}/${r.token_id}?signal=${r.id}`} className="flex items-center gap-2 hover:text-up"><TokenAvatar symbol={r.symbol} logo={r.logo_url} size={22} /><span className="font-medium">{r.symbol}</span><ChainBadge chain={r.chain} /></Link></td>
                      <td><SignalTypeBadge type={r.signal_type} /></td>
                      <td><StrengthBadge strength={r.strength} /></td>
                      <td className="num text-right">{r.ai_score}</td>
                      <td className="num text-right">{formatPrice(r.price_at_signal)}</td>
                      <td className="text-right">{o?.return_1h != null ? <PriceChange value={o.return_1h} /> : <span className="text-xs text-fg-faint">—</span>}</td>
                      <td className="text-right">{o?.return_6h != null ? <PriceChange value={o.return_6h} /> : <span className="text-xs text-fg-faint">—</span>}</td>
                      <td className="text-right">{o?.return_24h != null ? <PriceChange value={o.return_24h} /> : <span className="text-xs text-fg-faint">pending</span>}</td>
                      <td className="text-xs">{o?.hit_take_profit ? <Badge tone="up">TP1</Badge> : null} {o?.hit_invalidation ? <Badge tone="down">invalidated</Badge> : null}</td>
                      <td><Badge>{r.status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line"><Pagination base="/app/history" params={sp} page={page.page} pageSize={page.pageSize} total={page.total} /></div>
      </Card>
    </>
  );
}
