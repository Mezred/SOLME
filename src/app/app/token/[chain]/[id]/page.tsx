import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FactorList } from "@/components/app/factor-list";
import { DecisionCard } from "@/components/app/decision-card";
import { CURVE_DEXES } from "@/lib/decision/check-token";
import { HolderPanel } from "@/components/app/holder-panel";
import { failedCheckLabels, warnCheckLabels } from "@/lib/decision/evidence";
import { PriceChart } from "@/components/app/price-chart";
import { SecurityPanel } from "@/components/app/security-panel";
import { CopyAddress, WatchButton } from "@/components/app/token-actions";
import { EarlyBuyersCard, type EarlyBuyerRow } from "@/components/app/wallet-score";
import { Badge, Card, CardHeader, ChainBadge, DemoBadge, Freshness, PriceChange, TokenAvatar, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, isChainId } from "@/lib/chains";
import { isUuid, query, queryOne } from "@/lib/db";
import { liveScore } from "@/lib/data/live-score";
import { getLatestSecurity, getToken, getTokenPairs } from "@/lib/data/tokens";
import { formatAge, formatPrice, formatUsd } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/app/token/[chain]/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = isUuid(id) ? await queryOne<{ symbol: string }>("SELECT symbol FROM token_assets WHERE id = $1", [id]) : null;
  return { title: t ? `${t.symbol} token` : "Token" };
}

function Metric({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="px-4 py-2.5" title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="num mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export default async function TokenPage({ params }: PageProps<"/app/token/[chain]/[id]">) {
  const { chain, id } = await params;
  const user = await requirePageUser(`/app/token/${chain}/${id}`);
  if (!isUuid(id) || !isChainId(chain)) notFound();
  const [t, ent] = await Promise.all([getToken(id), getEntitlements(user.id)]);
  if (!t || t.chain !== chain) notFound();
  if (!ent.features.chains.includes(t.chain)) {
    return <UpgradeGate feature={`${CHAINS[t.chain].name} token data`} />;
  }
  const [sec, pairs, earlyBuyers, scan, watching] = await Promise.all([
    getLatestSecurity(id),
    getTokenPairs(id),
    query<EarlyBuyerRow>(
      `SELECT w.id, w.address, c.entry_delay_seconds, c.entry_sol, s.score, s.pnl_sol, s.bot_like
         FROM smart_money_candidates c JOIN wallet_profiles w ON w.id = c.wallet_id LEFT JOIN wallet_scores s ON s.wallet_id = w.id
        WHERE c.token_id = $1 ORDER BY s.score DESC NULLS LAST, c.entry_delay_seconds LIMIT 20`,
      [id],
    ),
    queryOne<{ launch_at: Date | null }>("SELECT launch_at FROM smart_money_scans WHERE token_id = $1", [id]),
    queryOne("SELECT 1 FROM watchlist_items WHERE user_id = $1 AND token_id = $2", [user.id, id]),
  ]);
  const live = await liveScore(t, sec);
  const primary = pairs.find((p) => p.is_primary) ?? pairs[0];
  // The stored score (computed with candles during ingestion) while fresh; otherwise a live recompute.
  const stored = t.metadata?.last_score;
  const fresh = stored && Date.now() - new Date(stored.at).getTime() < 6 * 3_600_000;
  const aiScore = fresh ? stored.ai : (live?.aiScore ?? null);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenAvatar symbol={t.symbol} logo={t.logo_url} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{t.symbol}</h1>
              <span className="truncate text-fg-muted">{t.name}</span>
              <ChainBadge chain={t.chain} />
              {t.is_demo && <DemoBadge />}
              {t.is_spam && <Badge tone="down" title={t.spam_reason ?? undefined}>Flagged: {t.spam_reason}</Badge>}
              {t.metadata?.promoted && <Badge tone="warn" title="Paid promotion is not a sign of quality">Promoted listing</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CopyAddress address={t.address} />
              <WatchButton tokenId={id} watching={Boolean(watching)} />
              {!t.is_demo && (
                <a href={CHAINS[t.chain].explorerAddress(t.address)} target="_blank" rel="noopener noreferrer" className="text-xs text-fg-faint hover:text-fg">
                  Explorer ↗
                </a>
              )}
              {primary?.url && (
                <a href={primary.url} target="_blank" rel="noopener noreferrer" className="text-xs text-fg-faint hover:text-fg">
                  DexScreener ↗
                </a>
              )}
              {t.metadata?.websites?.slice(0, 1).map((w) => (
                <a key={w} href={w} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-fg-faint hover:text-fg">
                  Website ↗
                </a>
              ))}
              {t.metadata?.socials?.slice(0, 3).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs capitalize text-fg-faint hover:text-fg">
                  {s.type} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <Suspense fallback={<Card><div className="px-4 py-6 text-sm text-fg-faint"><span className="cursor">Running pre-buy check</span></div></Card>}>
          <DecisionCard
            userId={user.id}
            t={{ chain: t.chain, address: t.address, is_demo: t.is_demo }}
            input={{
              priceUsd: t.price_usd,
              change: { m5: t.price_change_m5, h1: t.price_change_h1, h6: t.price_change_h6, h24: t.price_change_h24 },
              liquidityUsd: t.liquidity_usd,
              marketCapUsd: t.market_cap ?? t.fdv,
              ageHours: t.pair_created_at ? (Date.now() - new Date(t.pair_created_at).getTime()) / 3_600_000 : null,
              onBondingCurve: CURVE_DEXES.includes(primary?.dex_id ?? ""),
              buysH1: t.buys_h1,
              sellsH1: t.sells_h1,
              security: sec ? { riskLevel: sec.status === "unavailable" || sec.status === "error" ? null : sec.risk_level, failedChecks: failedCheckLabels(sec.checks), warnings: warnCheckLabels(sec.checks) } : null,
            }}
          />
        </Suspense>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
              <div>
                <div className="num text-2xl font-semibold">{formatPrice(t.price_usd)}</div>
                <div className="mt-0.5 flex gap-3 text-sm">
                  <span>1h <PriceChange value={t.price_change_h1} /></span>
                  <span>24h <PriceChange value={t.price_change_h24} /></span>
                </div>
              </div>
              <Freshness at={t.captured_at} label="Snapshot" />
            </div>
            <div className="mt-3">
              <PriceChart tokenId={t.id} />
            </div>
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4">
              <Metric label="Market cap">{formatUsd(t.market_cap ?? t.fdv)}</Metric>
              <Metric label="Liquidity">{formatUsd(t.liquidity_usd)}</Metric>
              <Metric label="Volume 24h">{formatUsd(t.volume_h24)}</Metric>
              <Metric label="Age">{formatAge(t.pair_created_at)}</Metric>
            </div>
          </Card>

          <details className="card group">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm text-fg-muted hover:text-fg">
              <span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span> All contract checks
            </summary>
            <SecurityPanel sec={sec} />
          </details>

          {live && (
            <details className="card group">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm text-fg-muted hover:text-fg">
                <span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span> How the score was built
                <span className="num ml-2 text-fg-faint">score {aiScore ?? live.aiScore} · data coverage {live.confidenceScore}%</span>
              </summary>
              <p className="border-t border-line px-4 py-3 text-sm text-fg-muted">{live.rationale}</p>
              <FactorList factors={live.factors} />
            </details>
          )}
        </div>

        <div className="space-y-4">
          {!t.is_demo && (
            <Suspense fallback={<Card><CardHeader title="Holders & launch" /><div className="px-4 py-8 text-center text-sm text-fg-faint">Reading on-chain holders…</div></Card>}>
              <HolderPanel chain={t.chain} address={t.address} />
            </Suspense>
          )}
          {earlyBuyers.length > 0 && <EarlyBuyersCard rows={earlyBuyers} launchAt={scan?.launch_at ?? null} />}
        </div>
      </div>
    </>
  );
}
