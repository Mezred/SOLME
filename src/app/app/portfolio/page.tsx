import type { Metadata } from "next";
import Link from "next/link";
import { LineChart } from "@/components/app/line-chart";
import { AddPositionForm, DeleteTrade, NewPortfolio, TradeForm } from "@/components/app/portfolio-forms";
import { Badge, buttonClass, Card, CardHeader, ChainBadge, cx, DemoBadge, EmptyState, Notice, PageHeader, PriceChange, Stat, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid, queryOne } from "@/lib/db";
import { loadPortfolio } from "@/lib/data/portfolio";
import { formatDateTime, formatNumber, formatPct, formatPrice, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Portfolio" };

const usd = (v: number | null) => (v === null ? "—" : `${v < 0 ? "-" : ""}${formatUsd(Math.abs(v), { compact: false })}`);
const tone = (v: number | null) => (v === null ? undefined : v > 0 ? ("up" as const) : v < 0 ? ("down" as const) : undefined);

export default async function PortfolioPage({ searchParams }: PageProps<"/app/portfolio">) {
  const user = await requirePageUser("/app/portfolio");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const { portfolios, current, positions, summary } = await loadPortfolio(user.id, typeof sp.p === "string" ? sp.p : undefined);
  const presetId = typeof sp.addToken === "string" && isUuid(sp.addToken) ? sp.addToken : null;
  const preset = presetId ? await queryOne<{ symbol: string; chain: string }>("SELECT symbol, chain FROM token_assets WHERE id = $1", [presetId]) : null;
  const advanced = ent.features.portfolio_analytics === "advanced";

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Manually recorded positions, valued with NEXALPHA's latest market snapshots. Weighted-average cost; fees are included in cost basis and deducted from proceeds."
        actions={
          <>
            {ent.features.csv_export ? (
              <a href="/api/portfolio/export" className={buttonClass("secondary", "sm")}>Export CSV</a>
            ) : (
              <span className={buttonClass("secondary", "sm", "opacity-50")} title="CSV export requires Pro">Export CSV (Pro)</span>
            )}
            <NewPortfolio />
          </>
        }
      />
      {portfolios.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {portfolios.map((p) => (
            <Link key={p.id} href={`/app/portfolio?p=${p.id}`} className={cx(buttonClass(p.id === current?.id ? "secondary" : "ghost", "sm"), p.id === current?.id && "border-up/40")}>{p.name}</Link>
          ))}
        </div>
      )}
      <div className="mb-4">
        <Notice tone="info">Manual positions are self-reported and are not verified on-chain. NEXALPHA never asks for private keys or deposits.</Notice>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Capital deployed" value={usd(summary.totalInvested)} />
        <Stat label="Market value" value={usd(summary.marketValue)} sub={summary.positionsMissingPrice ? `${summary.positionsMissingPrice} position(s) without a current price` : "Open positions"} />
        <Stat label="Realized P&L" value={usd(summary.realizedPnl)} tone={tone(summary.realizedPnl)} />
        <Stat label="Unrealized P&L" value={usd(summary.unrealizedPnl)} tone={tone(summary.unrealizedPnl)} sub={summary.unrealizedPnl === null ? "Unknown: missing prices" : undefined} />
        <Stat label="Total return" value={formatPct(summary.returnPct)} tone={tone(summary.returnPct)} />
      </div>

      {advanced ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader title="Equity curve" subtitle="Cumulative realized P&L at each exit, plus current unrealized P&L" />
            <div className="p-3">
              <LineChart label="Cumulative P&L" formatKind="usd" points={summary.equityCurve.map((p) => ({ x: p.at, y: p.cumulativePnl }))} />
            </div>
          </Card>
          <div className="grid gap-3">
            <Stat label="Win rate" value={summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`} sub={summary.winRate === null ? "Needs ≥3 closed positions" : `${summary.closedPositions} closed positions`} />
            <Stat label="Max drawdown" value={summary.maxDrawdownUsd === null ? "—" : usd(-summary.maxDrawdownUsd)} sub={summary.maxDrawdownPct === null ? "Needs ≥3 realized exits" : `${summary.maxDrawdownPct.toFixed(1)}% of capital deployed`} tone={summary.maxDrawdownUsd ? "down" : undefined} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-faint">Equity curve, win rate and drawdown are part of advanced portfolio analytics (Pro). <Link href="/app/billing" className="text-up">Upgrade</Link></p>
      )}

      <div className="mt-4">{current && <AddPositionForm portfolioId={current.id} preset={presetId && preset ? { tokenId: presetId, ...preset } : null} />}</div>

      <Card className="mt-4">
        <CardHeader title="Positions" subtitle={`${positions.filter((p) => p.status === "open").length} open · ${positions.filter((p) => p.status === "closed").length} closed`} />
        {positions.length === 0 ? (
          <EmptyState title="No positions yet" body="Record a trade to start tracking P&L. Use “Log a trade” on any token page to prefill it." />
        ) : (
          <div className="divide-y divide-line">
            {positions.map((p) => (
              <details key={p.id} className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[1.4fr_repeat(6,1fr)] items-center gap-3 px-4 py-2.5 text-sm hover:bg-ink-750 max-lg:grid-cols-3">
                  <span className="flex items-center gap-2">
                    <TokenAvatar symbol={p.token_symbol} logo={p.logo_url} size={24} />
                    <span className="font-semibold">{p.token_symbol}</span>
                    <ChainBadge chain={p.chain} />
                    {p.is_demo && <DemoBadge />}
                    <Badge tone={p.status === "open" ? "info" : "neutral"}>{p.status}</Badge>
                    <Badge title="User-reported; not verified on-chain">manual</Badge>
                  </span>
                  <span className="num text-right"><span className="block text-[10px] text-fg-faint">Qty</span>{formatNumber(p.metrics.openQuantity, 4)}</span>
                  <span className="num text-right"><span className="block text-[10px] text-fg-faint">Avg cost</span>{formatPrice(p.metrics.avgCost)}</span>
                  <span className="num text-right"><span className="block text-[10px] text-fg-faint">Price</span>{formatPrice(p.current_price)}</span>
                  <span className="num text-right"><span className="block text-[10px] text-fg-faint">Realized</span><span className={tone(p.metrics.realizedPnl) === "up" ? "text-up" : tone(p.metrics.realizedPnl) === "down" ? "text-down" : ""}>{usd(p.metrics.realizedPnl)}</span></span>
                  <span className="num text-right"><span className="block text-[10px] text-fg-faint">Unrealized</span><span className={tone(p.metrics.unrealizedPnl) === "up" ? "text-up" : tone(p.metrics.unrealizedPnl) === "down" ? "text-down" : ""}>{usd(p.metrics.unrealizedPnl)}</span></span>
                  <span className="text-right"><span className="block text-[10px] text-fg-faint">Return</span><PriceChange value={p.metrics.returnPct} /></span>
                </summary>
                <div className="space-y-3 bg-ink-900/50 px-4 py-3">
                  {p.metrics.error && <Notice tone="down">{p.metrics.error}</Notice>}
                  <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
                    <span>Stop loss: <span className="num text-down">{formatPrice(p.stop_loss)}</span></span>
                    {p.take_profits.map((tp, i) => <span key={i}>TP{i + 1}: <span className="num text-up">{formatPrice(tp.price)}</span></span>)}
                    <span>Fees paid: <span className="num">{usd(p.metrics.totalFees)}</span></span>
                    {p.token_id && <Link href={`/app/token/${p.chain}/${p.token_id}`} className="text-up">Token page →</Link>}
                  </div>
                  {p.notes && <p className="text-sm text-fg-muted">📓 {p.notes}</p>}
                  <table className="table-terminal">
                    <thead><tr><th>Time</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Fee</th><th>Note</th><th /></tr></thead>
                    <tbody>
                      {p.trades.map((t) => (
                        <tr key={t.id}>
                          <td>{formatDateTime(t.executedAt)}</td>
                          <td className={t.side === "buy" ? "text-up" : "text-down"}>{t.side}</td>
                          <td className="num text-right">{formatNumber(t.quantity, 6)}</td>
                          <td className="num text-right">{formatPrice(t.price)}</td>
                          <td className="num text-right">{usd(t.fee)}</td>
                          <td className="text-xs text-fg-faint">{t.note ?? ""}</td>
                          <td className="text-right"><DeleteTrade positionId={p.id} tradeId={t.id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <TradeForm positionId={p.id} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
