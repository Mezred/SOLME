import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Card, CardHeader, ChainBadge, DemoBadge, EmptyState, PageHeader, PriceChange, RiskBadge, ScoreRing, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { trendingTokens, type TokenRow } from "@/lib/data/tokens";
import { formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Discover Tokens" };

function TokenList({ rows, metric }: { rows: TokenRow[]; metric: "score" | "accel" | "h1" }) {
  if (!rows.length) return <EmptyState title="Nothing here yet" body="Lists fill as the engine ingests liquid, active tokens." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((t, i) => {
        const accel = t.volume_h1 && t.volume_h24 ? t.volume_h1 / (t.volume_h24 / 24) : null;
        return (
          <li key={t.id}>
            <Link href={`/app/token/${t.chain}/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-750">
              <span className="num w-4 text-xs text-fg-faint">{i + 1}</span>
              <TokenAvatar symbol={t.symbol} logo={t.logo_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-semibold">{t.symbol}</span>
                  <ChainBadge chain={t.chain} />
                  {t.is_demo && <DemoBadge />}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                  Liq {formatUsd(t.liquidity_usd)} · Vol {formatUsd(t.volume_h24)}
                  <RiskBadge level={t.security_risk} />
                </div>
              </div>
              {metric === "score" && <ScoreRing score={t.metadata?.last_score?.ai ?? null} size={34} />}
              {metric === "accel" && <span className="num text-sm text-up">{accel ? `${accel.toFixed(1)}×` : "—"}</span>}
              {metric === "h1" && <PriceChange value={t.price_change_h1} className="text-sm" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function DiscoverPage() {
  const user = await requirePageUser("/app/discover");
  const ent = await getEntitlements(user.id);
  const [byScore, byAccel, byMove] = await Promise.all([
    trendingTokens(ent.features.chains, "score"),
    trendingTokens(ent.features.chains, "volume_accel"),
    trendingTokens(ent.features.chains, "change_h1"),
  ]);
  return (
    <>
      <PageHeader
        title="Discover Tokens"
        description="Liquid (≥$25k) and active (≥$10k 24h volume) tokens updated in the last two hours. Big movers are not recommendations — check the security panel and factor breakdown before acting."
        actions={<AutoRefresh seconds={120} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Highest AI score" subtitle="Latest deterministic score" />
          <TokenList rows={byScore} metric="score" />
        </Card>
        <Card>
          <CardHeader title="Unusual volume" subtitle="Last-hour volume vs 24h hourly average" />
          <TokenList rows={byAccel} metric="accel" />
        </Card>
        <Card>
          <CardHeader title="Biggest 1h movers" subtitle="Price change only — not a signal on its own" />
          <TokenList rows={byMove} metric="h1" />
        </Card>
      </div>
    </>
  );
}
