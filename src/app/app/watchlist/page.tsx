import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { DeleteWatchlist, FavoriteToggle, NewWatchlist, RemoveItem } from "@/components/app/watchlist-controls";
import { Card, CardHeader, ChainBadge, DemoBadge, EmptyState, PageHeader, PriceChange, RiskBadge, ScoreRing, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { withUser } from "@/lib/db";
import { formatPrice, formatUsd, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Watchlist" };

interface Item {
  item_id: string;
  watchlist_id: string;
  is_favorite: boolean;
  token_id: string;
  chain: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  is_demo: boolean;
  last_score: number | null;
  price_usd: number | null;
  price_change_h1: number | null;
  price_change_h24: number | null;
  liquidity_usd: number | null;
  volume_h24: number | null;
  captured_at: Date | null;
  risk_level: string | null;
  last_signal: string | null;
}

export default async function WatchlistPage() {
  const user = await requirePageUser("/app/watchlist");
  const ent = await getEntitlements(user.id);
  const { lists, items } = await withUser(user.id, async (tx) => ({
    lists: await tx.query<{ id: string; name: string }>("SELECT id, name FROM watchlists ORDER BY created_at"),
    items: await tx.query<Item>(
      `SELECT i.id AS item_id, i.watchlist_id, i.is_favorite, t.id AS token_id, t.chain, t.symbol, t.name, t.logo_url, t.is_demo,
              (t.metadata->'last_score'->>'ai')::int AS last_score,
              snap.price_usd, snap.price_change_h1, snap.price_change_h24, snap.liquidity_usd, snap.volume_h24, snap.captured_at,
              sec.risk_level,
              (SELECT signal_type FROM signals s WHERE s.token_id = t.id AND s.status = 'active' ORDER BY created_at DESC LIMIT 1) AS last_signal
         FROM watchlist_items i JOIN token_assets t ON t.id = i.token_id
         LEFT JOIN LATERAL (SELECT * FROM market_snapshots ms WHERE ms.token_id = t.id ORDER BY captured_at DESC LIMIT 1) snap ON true
         LEFT JOIN LATERAL (SELECT risk_level FROM token_security_checks sc WHERE sc.token_id = t.id ORDER BY checked_at DESC LIMIT 1) sec ON true
        ORDER BY i.is_favorite DESC, i.added_at DESC`,
    ),
  }));
  return (
    <>
      <PageHeader
        title="Watchlist"
        description={`${items.length} of ${ent.features.max_watchlist_items} tokens · ${lists.length} of ${ent.features.max_watchlists} lists on your plan. Watched tokens are refreshed every ingestion cycle even when they are not trending.`}
        actions={<><NewWatchlist /><AutoRefresh seconds={90} /></>}
      />
      <div className="space-y-4">
        {lists.map((l) => {
          const rows = items.filter((i) => i.watchlist_id === l.id);
          return (
            <Card key={l.id}>
              <CardHeader title={l.name} subtitle={`${rows.length} tokens`} action={lists.length > 1 ? <DeleteWatchlist id={l.id} /> : undefined} />
              {rows.length === 0 ? (
                <EmptyState title="No tokens yet" body={<>Open any token from <Link href="/app/signals" className="text-up">Live Signals</Link> or the <Link href="/app/screener" className="text-up">Screener</Link> and choose “Add to watchlist”.</>} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-terminal">
                    <thead>
                      <tr><th className="w-6" /><th>Token</th><th>Score</th><th className="text-right">Price</th><th className="text-right">1h</th><th className="text-right">24h</th><th className="text-right">Liquidity</th><th className="text-right">Vol 24h</th><th>Security</th><th>Active signal</th><th className="text-right">Updated</th><th /></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.item_id}>
                          <td><FavoriteToggle itemId={r.item_id} favorite={r.is_favorite} /></td>
                          <td>
                            <Link href={`/app/token/${r.chain}/${r.token_id}`} className="flex items-center gap-2 hover:text-up">
                              <TokenAvatar symbol={r.symbol} logo={r.logo_url} />
                              <span className="font-semibold">{r.symbol}</span>
                              <ChainBadge chain={r.chain} />
                              {r.is_demo && <DemoBadge />}
                            </Link>
                          </td>
                          <td><ScoreRing score={r.last_score} size={30} /></td>
                          <td className="num text-right">{formatPrice(r.price_usd)}</td>
                          <td className="text-right"><PriceChange value={r.price_change_h1} /></td>
                          <td className="text-right"><PriceChange value={r.price_change_h24} /></td>
                          <td className="num text-right">{formatUsd(r.liquidity_usd)}</td>
                          <td className="num text-right">{formatUsd(r.volume_h24)}</td>
                          <td><RiskBadge level={r.risk_level} /></td>
                          <td className="text-xs text-fg-muted">{r.last_signal?.replace("_", " ") ?? "—"}</td>
                          <td className="text-right text-xs text-fg-faint">{timeAgo(r.captured_at)}</td>
                          <td><RemoveItem itemId={r.item_id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
