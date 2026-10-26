import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Badge, ButtonLink, Card, ChainBadge, DemoBadge, EmptyState, PageHeader, PriceChange, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { loadPortfolio } from "@/lib/data/portfolio";
import { withUser } from "@/lib/db";
import { formatNumber, formatPct, formatPrice, formatUsd, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Open Positions" };

export default async function PositionsPage() {
  const user = await requirePageUser("/app/positions");
  const portfolios = await withUser(user.id, (tx) => tx.query<{ id: string; name: string }>("SELECT id, name FROM portfolios ORDER BY created_at"));
  const loaded = await Promise.all(portfolios.map((p) => loadPortfolio(user.id, p.id)));
  const open = loaded.flatMap((l) => l.positions.filter((p) => p.status === "open").map((p) => ({ ...p, portfolio: l.current?.name ?? "" })));

  return (
    <>
      <PageHeader
        title="Open Positions"
        description="Live P&L and distance to your stop-loss and take-profit levels across all portfolios. Prices older than 6 hours are treated as unavailable."
        actions={<><AutoRefresh seconds={60} /><ButtonLink href="/app/portfolio" size="sm" variant="primary">Record position</ButtonLink></>}
      />
      <Card>
        {open.length === 0 ? (
          <EmptyState title="No open positions" body={<>Record trades on the <Link href="/app/portfolio" className="text-up">Portfolio</Link> page.</>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead>
                <tr><th>Token</th><th>Portfolio</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">Unrealized</th><th className="text-right">Return</th><th className="text-right">To stop</th><th className="text-right">To TP1</th><th className="text-right">Price age</th></tr>
              </thead>
              <tbody>
                {open.map((p) => {
                  const px = p.metrics.marketValue !== null && p.metrics.openQuantity ? p.metrics.marketValue / p.metrics.openQuantity : null;
                  const toStop = px && p.stop_loss ? ((p.stop_loss - px) / px) * 100 : null;
                  const tp1 = p.take_profits[0]?.price;
                  const toTp = px && tp1 ? ((tp1 - px) / px) * 100 : null;
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <TokenAvatar symbol={p.token_symbol} logo={p.logo_url} />
                          {p.token_id ? <Link href={`/app/token/${p.chain}/${p.token_id}`} className="font-semibold hover:text-up">{p.token_symbol}</Link> : <span className="font-semibold">{p.token_symbol}</span>}
                          <ChainBadge chain={p.chain} />
                          {p.is_demo && <DemoBadge />}
                          <Badge>manual</Badge>
                        </span>
                      </td>
                      <td className="text-fg-muted">{p.portfolio}</td>
                      <td className="num text-right">{formatNumber(p.metrics.openQuantity, 4)}</td>
                      <td className="num text-right">{formatPrice(p.metrics.avgCost)}</td>
                      <td className="num text-right">{formatPrice(px)}</td>
                      <td className="num text-right">{formatUsd(p.metrics.marketValue)}</td>
                      <td className={`num text-right ${(p.metrics.unrealizedPnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>{p.metrics.unrealizedPnl === null ? "—" : formatUsd(p.metrics.unrealizedPnl, { compact: false })}</td>
                      <td className="text-right"><PriceChange value={p.metrics.returnPct} /></td>
                      <td className={`num text-right ${toStop !== null && toStop > -5 ? "text-warn" : "text-fg-muted"}`}>{formatPct(toStop)}</td>
                      <td className="num text-right text-fg-muted">{formatPct(toTp)}</td>
                      <td className="text-right text-xs text-fg-faint">{timeAgo(p.price_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
