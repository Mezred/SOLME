import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { SignalsTable } from "@/components/app/signals-table";
import { Badge, ButtonLink, Card, CardHeader, ChainBadge, Disclaimer, EmptyState, Freshness, Notice, PageHeader, PriceChange, Stat, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, CHAIN_IDS } from "@/lib/chains";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { listSignals, signalStats } from "@/lib/data/signals";
import { lastIngestion, latestSnapshotTime } from "@/lib/data/tokens";
import { formatPrice, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: PageProps<"/app">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const [stats, top, latest, ingestion, watch, notes] = await Promise.all([
    signalStats(ent),
    listSignals({ chain: [], type: ["momentum", "accumulation", "breakout_watch"], strength: [], sort: "score", pageSize: 8 }, ent),
    latestSnapshotTime(),
    lastIngestion(),
    query<{ token_id: string; chain: string; symbol: string; logo_url: string | null; price_usd: number | null; price_change_h24: number | null }>(
      `SELECT t.id AS token_id, t.chain, t.symbol, t.logo_url, snap.price_usd, snap.price_change_h24
         FROM watchlist_items wi JOIN token_assets t ON t.id = wi.token_id
         LEFT JOIN LATERAL (SELECT price_usd, price_change_h24 FROM market_snapshots ms WHERE ms.token_id = t.id ORDER BY captured_at DESC LIMIT 1) snap ON true
        WHERE wi.user_id = $1 ORDER BY wi.is_favorite DESC, wi.added_at DESC LIMIT 8`,
      [user.id],
    ),
    query<{ id: string; title: string; body: string; link: string | null; created_at: Date; read_at: Date | null }>(
      "SELECT id, title, body, link, created_at, read_at FROM notifications WHERE user_id = $1 AND channel = 'in_app' ORDER BY created_at DESC LIMIT 6",
      [user.id],
    ),
  ]);
  const regime = ingestion?.value.regime ?? {};

  return (
    <>
      <PageHeader
        title={`Overview`}
        description={`Signed in as ${user.displayName ?? user.email} · ${ent.planName} plan`}
        badge={<Freshness at={latest} label="Market data" />}
        actions={<AutoRefresh seconds={90} />}
      />
      {sp.welcome && (
        <div className="mb-4">
          <Notice tone="info" title="Welcome to NEXALPHA">
            Start with Live Signals, add tokens to your watchlist, and set an alert. Every score links to its evidence — open any token to see why it scored the way it did.
          </Notice>
        </div>
      )}
      {!latest && !env.demoMode && (
        <div className="mb-4">
          <Notice tone="warn" title="Waiting for the first ingestion cycle">
            The background worker pulls live data roughly every two minutes. If this persists, an administrator should check provider health in the admin panel.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active signals" value={stats?.active ?? 0} sub={`${stats?.last24h ?? 0} in 24h · ${ent.features.chains.length} chains on your plan`} />
        <Stat label="Bullish patterns" value={(stats?.momentum ?? 0) + (stats?.accumulation ?? 0) + (stats?.breakout ?? 0)} sub={`${stats?.momentum ?? 0} momentum · ${stats?.accumulation ?? 0} accum. · ${stats?.breakout ?? 0} breakout`} tone="up" />
        <Stat label="Warnings" value={(stats?.distribution ?? 0) + (stats?.high_risk ?? 0)} sub={`${stats?.distribution ?? 0} distribution · ${stats?.high_risk ?? 0} high risk`} tone="down" />
        <Stat label="Last cycle" value={ingestion?.value.finishedAt ? timeAgo(ingestion.value.finishedAt) : "—"} sub={ingestion ? `${ingestion.value.stored ?? 0} tokens · ${ingestion.value.signalsCreated ?? 0} new signals` : "No cycle yet"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            title="Top bullish signals"
            subtitle="Highest AI score among active momentum, accumulation and breakout signals on your plan"
            action={<ButtonLink href="/app/signals" size="sm">All signals →</ButtonLink>}
          />
          <SignalsTable rows={top.rows} base="/app/signals" params={{}} sortable={false} emptyText="No active bullish signals right now" />
          {top.restrictions.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-warn">{top.restrictions.join(" ")}</p>}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Market regime" subtitle="24h change of each chain's native asset" />
            <ul className="divide-y divide-line">
              {CHAIN_IDS.map((c) => (
                <li key={c} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <ChainBadge chain={c} /> {CHAINS[c].nativeSymbol}
                  </span>
                  {env.demoMode ? <Badge>demo</Badge> : <PriceChange value={regime[c] ?? null} />}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Watchlist" action={<Link href="/app/watchlist" className="text-xs text-up hover:underline">Manage</Link>} />
            {watch.length === 0 ? (
              <EmptyState title="Your watchlist is empty" body="Add tokens from any token page." />
            ) : (
              <ul className="divide-y divide-line">
                {watch.map((w) => (
                  <li key={w.token_id}>
                    <Link href={`/app/token/${w.chain}/${w.token_id}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-ink-750">
                      <TokenAvatar symbol={w.symbol} logo={w.logo_url} size={22} />
                      <span className="font-medium">{w.symbol}</span>
                      <span className="num ml-auto text-fg-muted">{formatPrice(w.price_usd)}</span>
                      <PriceChange value={w.price_change_h24} className="w-16 text-right" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent alerts" action={<Link href="/app/alerts?tab=inbox" className="text-xs text-up hover:underline">Inbox</Link>} />
            {notes.length === 0 ? (
              <EmptyState title="No alerts yet" body="Create alert rules to be notified about price moves, new signals and security changes." />
            ) : (
              <ul className="divide-y divide-line">
                {notes.map((n) => (
                  <li key={n.id} className="px-4 py-2.5">
                    <Link href={n.link ?? "/app/alerts?tab=inbox"} className="block">
                      <div className={`text-sm ${n.read_at ? "text-fg-muted" : "font-medium"}`}>{n.title}</div>
                      <div className="text-xs text-fg-faint">{timeAgo(n.created_at)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Disclaimer className="mt-6" />
    </>
  );
}
