import type { Metadata } from "next";
import Link from "next/link";
import { AnalysisButton } from "@/components/app/ai-chat";
import { FactorList } from "@/components/app/factor-list";
import { SecurityPanel } from "@/components/app/security-panel";
import { Badge, ButtonLink, Card, CardHeader, ChainBadge, DemoBadge, EmptyState, Freshness, PageHeader, PriceChange, ScoreRing, SignalTypeBadge, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid } from "@/lib/db";
import { integrations } from "@/lib/env";
import { liveScore } from "@/lib/data/live-score";
import { getLatestSecurity, getToken, trendingTokens } from "@/lib/data/tokens";
import { formatAge, formatPrice, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "AI Analysis" };

export default async function AiAnalysisPage({ searchParams }: PageProps<"/app/ai">) {
  const user = await requirePageUser("/app/ai");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const tokenId = typeof sp.tokenId === "string" && isUuid(sp.tokenId) ? sp.tokenId : null;
  const t = tokenId ? await getToken(tokenId) : null;
  const allowed = t && ent.features.chains.includes(t.chain);
  const sec = t && allowed ? await getLatestSecurity(t.id) : null;
  const score = t && allowed ? await liveScore(t, sec) : null;
  const suggestions = t ? [] : await trendingTokens(ent.features.chains, "score", 9);

  return (
    <>
      <PageHeader
        title="AI Analysis"
        description="A deterministic research report for any tracked token — score factors, evidence, risk flags and security — with an optional AI-written narrative grounded in the same data."
        actions={<ButtonLink href="/app/chat" variant="ai" size="sm">Open AI Chat</ButtonLink>}
      />
      {!t ? (
        <Card>
          <CardHeader title="Choose a token" subtitle="Use the search bar above, open a token page and click “AI analysis”, or pick one of the highest-scoring tokens:" />
          {suggestions.length === 0 ? <EmptyState title="No tokens available yet" /> : (
            <ul className="grid gap-px bg-line sm:grid-cols-3">
              {suggestions.map((s) => (
                <li key={s.id} className="bg-ink-850">
                  <Link href={`/app/ai?tokenId=${s.id}`} className="flex items-center gap-2 px-4 py-3 hover:bg-ink-750">
                    <TokenAvatar symbol={s.symbol} logo={s.logo_url} />
                    <span className="font-semibold">{s.symbol}</span>
                    <ChainBadge chain={s.chain} />
                    <span className="ml-auto"><ScoreRing score={s.metadata?.last_score?.ai ?? null} size={30} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : !allowed ? (
        <EmptyState title="This token's chain is not included in your plan" action={<ButtonLink href="/app/billing" variant="primary">View plans</ButtonLink>} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <TokenAvatar symbol={t.symbol} logo={t.logo_url} size={40} />
                <div>
                  <div className="flex items-center gap-2"><Link href={`/app/token/${t.chain}/${t.id}`} className="text-lg font-semibold hover:text-up">{t.symbol}</Link><ChainBadge chain={t.chain} />{t.is_demo && <DemoBadge />}</div>
                  <Freshness at={t.captured_at} label="Snapshot" />
                </div>
                <div className="ml-auto flex items-center gap-4 text-sm">
                  <span className="num">{formatPrice(t.price_usd)}</span>
                  <span>1h <PriceChange value={t.price_change_h1} /></span>
                  <span>24h <PriceChange value={t.price_change_h24} /></span>
                  <span className="text-fg-muted">Liq {formatUsd(t.liquidity_usd)}</span>
                  <span className="text-fg-muted">Age {formatAge(t.pair_created_at)}</span>
                </div>
              </div>
            </Card>
            {score && (
              <Card>
                <CardHeader title="Deterministic assessment" subtitle={`Scoring ${score.version} · computed from the latest snapshot`} action={<SignalTypeBadge type={score.signalType} />} />
                <div className="grid grid-cols-5 gap-2 border-b border-line px-4 py-3 text-center">
                  {([["AI score", score.aiScore], ["Quality", score.qualityScore], ["Momentum", score.momentumScore], ["Risk", score.riskScore], ["Confidence", score.confidenceScore]] as const).map(([l, v]) => (
                    <div key={l} className="flex flex-col items-center gap-1"><ScoreRing score={v} size={44} label={l} /><span className="text-[10px] uppercase text-fg-faint">{l}</span></div>
                  ))}
                </div>
                <p className="border-b border-line px-4 py-3 text-sm text-fg-muted">{score.rationale}</p>
                <div className="grid lg:grid-cols-2">
                  <div className="border-line lg:border-r"><FactorList factors={score.factors} /></div>
                  <div className="space-y-3 p-4 text-sm">
                    <div>
                      <div className="mb-1 text-xs font-medium text-warn">Risk flags</div>
                      {score.riskFlags.length ? <ul className="space-y-1 text-xs text-fg-muted">{score.riskFlags.map((f) => <li key={f}>• {f}</li>)}</ul> : <p className="text-xs text-fg-faint">None raised.</p>}
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-fg-muted">Signal eligibility</div>
                      {score.eligibility.eligible ? <Badge tone="up">Meets publication criteria</Badge> : <ul className="space-y-1 text-xs text-fg-faint">{score.eligibility.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-fg-muted">Missing data</div>
                      <p className="text-xs text-fg-faint">{score.missingData.join(", ") || "None"}</p>
                    </div>
                  </div>
                </div>
              </Card>
            )}
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">AI research narrative</h2>
              <AnalysisButton tokenId={t.id} symbol={t.symbol} configured={integrations.ai} allowed={ent.features.ai_deep_analysis} />
            </Card>
          </div>
          <Card className="self-start"><SecurityPanel sec={sec} /></Card>
        </div>
      )}
    </>
  );
}
