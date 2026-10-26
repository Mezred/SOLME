import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Freshness, Notice, PageHeader, PriceChange, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS } from "@/lib/chains";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { lastIngestion } from "@/lib/data/tokens";
import { formatPct, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Market Intelligence" };

const LATEST = `LEFT JOIN LATERAL (SELECT * FROM market_snapshots ms WHERE ms.token_id = t.id ORDER BY captured_at DESC LIMIT 1) snap ON true`;

export default async function IntelligencePage() {
  const user = await requirePageUser("/app/intelligence");
  const ent = await getEntitlements(user.id);
  const level = ent.features.market_intelligence;
  const chains = ent.features.chains;
  const [summary, movers, risk, sigmix, ing] = await Promise.all([
    query<{ chain: string; tokens: number; volume: number | null; liquidity: number | null; median_h24: number | null; up_share: number | null; new_pairs: number }>(
      `SELECT t.chain, count(*)::int AS tokens, sum(snap.volume_h24) AS volume, sum(snap.liquidity_usd) AS liquidity,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY snap.price_change_h24) AS median_h24,
              100.0 * avg(CASE WHEN snap.price_change_h24 > 0 THEN 1 ELSE 0 END) AS up_share,
              count(*) FILTER (WHERE t.pair_created_at > now() - interval '24 hours')::int AS new_pairs
         FROM token_assets t ${LATEST}
        WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) AND snap.captured_at > now() - interval '3 hours' AND snap.liquidity_usd >= 25000
        GROUP BY t.chain ORDER BY t.chain`,
      [env.demoMode, chains],
    ),
    level === "basic" ? Promise.resolve([]) : query<{ id: string; chain: string; symbol: string; logo_url: string | null; price_change_h24: number; volume_h24: number; liquidity_usd: number }>(
      `SELECT t.id, t.chain, t.symbol, t.logo_url, snap.price_change_h24, snap.volume_h24, snap.liquidity_usd
         FROM token_assets t ${LATEST}
        WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) AND snap.captured_at > now() - interval '3 hours'
          AND snap.liquidity_usd >= 100000 AND snap.price_change_h24 IS NOT NULL
        ORDER BY snap.price_change_h24 DESC`,
      [env.demoMode, chains],
    ),
    level !== "advanced" ? Promise.resolve([]) : query<{ risk: string; n: number }>(
      `SELECT COALESCE(sec.risk_level, 'unchecked') AS risk, count(*)::int AS n FROM token_assets t ${LATEST}
         LEFT JOIN LATERAL (SELECT risk_level FROM token_security_checks sc WHERE sc.token_id = t.id ORDER BY checked_at DESC LIMIT 1) sec ON true
        WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) AND snap.captured_at > now() - interval '3 hours' AND snap.liquidity_usd >= 25000
        GROUP BY 1 ORDER BY 2 DESC`,
      [env.demoMode, chains],
    ),
    query<{ signal_type: string; n: number }>(
      `SELECT signal_type, count(*)::int AS n FROM signals WHERE is_demo = $1 AND chain = ANY($2) AND created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC`,
      [env.demoMode, chains],
    ),
    lastIngestion(),
  ]);
  const gainers = movers.slice(0, 8);
  const losers = [...movers].reverse().slice(0, 8);
  const totalRisk = risk.reduce((s, r) => s + r.n, 0) || 1;

  return (
    <>
      <PageHeader
        title="Market Intelligence"
        description="Aggregates across liquid tokens (≥$25k liquidity) that NEXALPHA tracked in the last 3 hours. This is a sample of DEX activity — not the whole market."
        badge={<Freshness at={ing?.value.finishedAt ?? null} label="Cycle" />}
        actions={<AutoRefresh seconds={180} />}
      />
      {level !== "advanced" && <div className="mb-4"><Notice tone="ai">{level === "basic" ? "Movers, risk distribution and signal mix are part of Standard (Pro) and Advanced (Elite) intelligence." : "Risk distribution is part of Advanced intelligence (Elite)."} <Link href="/app/billing" className="underline">Compare plans</Link></Notice></div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.length === 0 && <div className="sm:col-span-2 xl:col-span-4"><EmptyState title="No recent market data" /></div>}
        {summary.map((s) => (
          <Card key={s.chain} className="p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold"><ChainBadge chain={s.chain} /> {CHAINS[s.chain as keyof typeof CHAINS]?.name}</span>
              {env.demoMode ? <Badge tone="warn">demo</Badge> : <span className="text-xs text-fg-faint">{CHAINS[s.chain as keyof typeof CHAINS]?.nativeSymbol} <PriceChange value={ing?.value.regime?.[s.chain] ?? null} /></span>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-fg-faint">Tracked tokens</dt><dd className="num text-right">{s.tokens}</dd>
              <dt className="text-fg-faint">24h volume</dt><dd className="num text-right">{formatUsd(s.volume)}</dd>
              <dt className="text-fg-faint">Pooled liquidity</dt><dd className="num text-right">{formatUsd(s.liquidity)}</dd>
              <dt className="text-fg-faint">Median 24h</dt><dd className="text-right"><PriceChange value={s.median_h24} /></dd>
              <dt className="text-fg-faint">Breadth (up 24h)</dt><dd className="num text-right">{formatPct(s.up_share, 0).replace("+", "")}</dd>
              <dt className="text-fg-faint">New pairs 24h</dt><dd className="num text-right">{s.new_pairs}</dd>
            </dl>
          </Card>
        ))}
      </div>

      {level !== "basic" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {([["Top gainers · 24h", gainers], ["Top losers · 24h", losers]] as const).map(([title, rows]) => (
            <Card key={title}>
              <CardHeader title={title} subtitle="Liquidity ≥ $100k" />
              {rows.length === 0 ? <EmptyState title="No data" /> : (
                <ul className="divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/token/${r.chain}/${r.id}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-ink-750">
                        <TokenAvatar symbol={r.symbol} logo={r.logo_url} size={22} />
                        <span className="font-medium">{r.symbol}</span>
                        <ChainBadge chain={r.chain} />
                        <span className="num ml-auto text-xs text-fg-faint">vol {formatUsd(r.volume_h24)}</span>
                        <PriceChange value={r.price_change_h24} className="w-20 text-right" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {level !== "basic" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Signal mix · 24h" />
            {sigmix.length === 0 ? <EmptyState title="No signals in 24h" /> : (
              <table className="table-terminal"><tbody>{sigmix.map((s) => <tr key={s.signal_type}><td className="capitalize">{s.signal_type.replace("_", " ")}</td><td className="num text-right">{s.n}</td></tr>)}</tbody></table>
            )}
          </Card>
          {level === "advanced" && (
            <Card>
              <CardHeader title="Security risk distribution" subtitle="Latest check per liquid token" />
              <table className="table-terminal">
                <thead><tr><th>Risk level</th><th className="text-right">Tokens</th><th className="text-right">Share</th></tr></thead>
                <tbody>{risk.map((r) => <tr key={r.risk}><td className="capitalize">{r.risk === "unknown" ? "Unverified" : r.risk}</td><td className="num text-right">{r.n}</td><td className="num text-right">{((r.n / totalRisk) * 100).toFixed(0)}%</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
