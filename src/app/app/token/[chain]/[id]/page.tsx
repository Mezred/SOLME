import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { FactorList } from "@/components/app/factor-list";
import { PriceChart } from "@/components/app/price-chart";
import { SecurityPanel } from "@/components/app/security-panel";
import { CopyAddress, TokenLinks, WatchButton } from "@/components/app/token-actions";
import { Badge, Card, CardHeader, ChainBadge, DemoBadge, Disclaimer, EmptyState, Freshness, Notice, PriceChange, ScoreRing, SignalTypeBadge, StrengthBadge, TokenAvatar, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, isChainId } from "@/lib/chains";
import { isUuid, queryOne } from "@/lib/db";
import { liveScore } from "@/lib/data/live-score";
import { getSignal } from "@/lib/data/signals";
import { getLatestSecurity, getToken, getTokenPairs, getTokenSignals } from "@/lib/data/tokens";
import { formatAge, formatCompact, formatDateTime, formatPrice, formatUsd, shortAddress, timeAgo } from "@/lib/format";

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

export default async function TokenPage({ params, searchParams }: PageProps<"/app/token/[chain]/[id]">) {
  const { chain, id } = await params;
  const sp = await searchParams;
  const user = await requirePageUser(`/app/token/${chain}/${id}`);
  if (!isUuid(id) || !isChainId(chain)) notFound();
  const [t, ent] = await Promise.all([getToken(id), getEntitlements(user.id)]);
  if (!t || t.chain !== chain) notFound();
  if (!ent.features.chains.includes(t.chain)) {
    return <UpgradeGate feature={`${CHAINS[t.chain].name} token data`} />;
  }
  const [sec, pairs, signals, watching] = await Promise.all([
    getLatestSecurity(id),
    getTokenPairs(id),
    getTokenSignals(id, 15),
    queryOne("SELECT 1 FROM watchlist_items WHERE user_id = $1 AND token_id = $2", [user.id, id]),
  ]);
  const signalId = typeof sp.signal === "string" && isUuid(sp.signal) ? sp.signal : signals[0]?.id;
  const sig = signalId ? await getSignal(signalId) : null;
  const delayOk = !sig || ent.features.signal_delay_minutes === 0 || Date.now() - new Date(sig.signal.created_at).getTime() >= ent.features.signal_delay_minutes * 60_000;
  const live = await liveScore(t, sec);
  const primary = pairs.find((p) => p.is_primary) ?? pairs[0];
  const s = sig && delayOk ? sig.signal : null;
  const levels = s && s.entry_low !== null
    ? [
        { price: s.entry_low, label: "Entry low", color: "#4d8dff" },
        ...(s.invalidation !== null ? [{ price: s.invalidation, label: "Invalidation", color: "#ff4d5e" }] : []),
        ...(s.take_profits ?? []).map((tp) => ({ price: tp.price, label: tp.label, color: "#1fe08a" })),
      ]
    : undefined;
  const txRatio = (b: number | null, sl: number | null) => (b !== null && sl !== null && b + sl > 0 ? `${b} / ${sl} (${Math.round((b / (b + sl)) * 100)}% buys)` : "—");

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
              {t.metadata?.promoted && <Badge tone="warn" title="Paid promotion is not a quality signal">Promoted listing</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CopyAddress address={t.address} />
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
        <div className="flex flex-wrap items-center gap-2">
          <WatchButton tokenId={t.id} watching={Boolean(watching)} />
          <TokenLinks tokenId={t.id} chain={t.chain} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
              <div>
                <div className="num text-2xl font-semibold">{formatPrice(t.price_usd)}</div>
                <div className="mt-0.5 flex gap-3 text-sm">
                  <span>5m <PriceChange value={t.price_change_m5} /></span>
                  <span>1h <PriceChange value={t.price_change_h1} /></span>
                  <span>6h <PriceChange value={t.price_change_h6} /></span>
                  <span>24h <PriceChange value={t.price_change_h24} /></span>
                  <span title="7-day change is not provided by the current market data provider">7d <span className="text-fg-faint">n/a</span></span>
                </div>
              </div>
              <Freshness at={t.captured_at} label="Snapshot" />
            </div>
            <div className="mt-3">
              <PriceChart tokenId={t.id} levels={levels} />
            </div>
          </Card>

          <Card>
            <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 [&>*]:border-line">
              <Metric label="Liquidity">{formatUsd(t.liquidity_usd)}</Metric>
              <Metric label="Market cap">{formatUsd(t.market_cap)}</Metric>
              <Metric label="FDV">{formatUsd(t.fdv)}</Metric>
              <Metric label="Volume 24h">{formatUsd(t.volume_h24)}</Metric>
              <Metric label="Volume 1h">{formatUsd(t.volume_h1)}</Metric>
              <Metric label="Buys / sells 1h" hint="Transaction counts, not size">{txRatio(t.buys_h1, t.sells_h1)}</Metric>
              <Metric label="Buys / sells 24h">{txRatio(t.buys_h24, t.sells_h24)}</Metric>
              <Metric label="Holders">{formatCompact(t.holder_count)}</Metric>
              <Metric label="Pair age">{formatAge(t.pair_created_at)}</Metric>
              <Metric label="DEX">{primary?.dex_id ?? "—"}</Metric>
              <Metric label="Quote">{primary?.quote_symbol ?? "—"}</Metric>
              <Metric label="First seen">{timeAgo(t.first_seen_at)}</Metric>
            </div>
          </Card>

          <Card>
            <CardHeader title="Signal history for this token" subtitle="Outcomes are measured from later snapshots" />
            {signals.length === 0 ? (
              <EmptyState title="No signals recorded" body="This token has not matched a documented pattern with enough confidence yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-terminal">
                  <thead>
                    <tr><th>When</th><th>Type</th><th>Strength</th><th className="text-right">Score</th><th className="text-right">Conf.</th><th className="text-right">Price then</th><th className="text-right">24h after</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {signals.map((x) => (
                      <tr key={x.id}>
                        <td><Link href={`?signal=${x.id}`} className="hover:text-up">{formatDateTime(x.created_at)}</Link></td>
                        <td><SignalTypeBadge type={x.signal_type} /></td>
                        <td><StrengthBadge strength={x.strength} /></td>
                        <td className="num text-right">{x.ai_score}</td>
                        <td className="num text-right text-fg-muted">{x.confidence_score}</td>
                        <td className="num text-right">{formatPrice(x.price_at_signal)}</td>
                        <td className="text-right">{x.return_24h === null ? <span className="text-xs text-fg-faint">not yet measured</span> : <PriceChange value={x.return_24h} />}</td>
                        <td><Badge>{x.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={s ? "Signal analysis" : "Current score"}
              subtitle={s ? `Signal ${timeAgo(s.created_at)} · scoring ${sig!.signal.scoring_version}` : "Recomputed from the latest snapshot (no candle-based factors)"}
              action={s ? <SignalTypeBadge type={s.signal_type} /> : live?.signalType ? <SignalTypeBadge type={live.signalType} /> : undefined}
            />
            {!delayOk && <div className="p-4"><Notice tone="warn">This signal is within your plan&apos;s {ent.features.signal_delay_minutes}-minute delay window.</Notice></div>}
            {(s || live) && (
              <div className="grid grid-cols-4 gap-2 border-b border-line px-4 py-3 text-center">
                {[
                  ["AI", s?.ai_score ?? live?.aiScore],
                  ["Quality", s?.quality_score ?? live?.qualityScore],
                  ["Momentum", s?.momentum_score ?? live?.momentumScore],
                  ["Confidence", s?.confidence_score ?? live?.confidenceScore],
                ].map(([l, v]) => (
                  <div key={l as string} className="flex flex-col items-center gap-1">
                    <ScoreRing score={v as number | null} size={42} label={l as string} />
                    <span className="text-[10px] uppercase tracking-wide text-fg-faint">{l}</span>
                  </div>
                ))}
              </div>
            )}
            {(s || live) && (
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-faint">Risk score</span>
                  <span className={`num ${(s?.risk_score ?? live?.riskScore ?? 0) >= 60 ? "text-down" : "text-fg-muted"}`}>{s?.risk_score ?? live?.riskScore}/100</span>
                </div>
                <p className="mt-2 text-sm text-fg-muted">{s?.rationale ?? live?.rationale}</p>
              </div>
            )}
            {s && s.entry_low !== null && (
              <div className="border-b border-line px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Scenario levels</span>
                  <Badge tone="ai">Model scenario · not advice</Badge>
                </div>
                <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-fg-faint">Entry zone</dt><dd className="text-right">{formatPrice(s.entry_low)} – {formatPrice(s.entry_high)}</dd>
                  <dt className="text-fg-faint">Invalidation</dt><dd className="text-right text-down">{formatPrice(s.invalidation)}</dd>
                  <dt className="text-fg-faint">Stop-loss scenario</dt><dd className="text-right text-down">{formatPrice(s.stop_loss)}</dd>
                  {(s.take_profits ?? []).map((tp) => (
                    <Fragment key={tp.label}>
                      <dt className="text-fg-faint">{tp.label} ({tp.rMultiple}R)</dt>
                      <dd className="text-right text-up">{formatPrice(tp.price)}</dd>
                    </Fragment>
                  ))}
                </dl>
                <p className="mt-2 text-[11px] text-fg-faint">Derived from ATR and recent swing lows on 15-minute candles. Levels describe a hypothetical risk structure only.</p>
              </div>
            )}
            {(s ? sig!.factors : live?.factors) && (
              <FactorList factors={(s ? sig!.factors.map((f) => ({ ...f, key: f.factor_key })) : live!.factors)} />
            )}
            {(s?.risk_flags ?? live?.riskFlags ?? []).length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <div className="mb-1.5 text-xs font-medium text-warn">Risk flags</div>
                <ul className="space-y-1 text-xs text-fg-muted">
                  {(s?.risk_flags ?? live?.riskFlags ?? []).map((f) => <li key={f}>• {f}</li>)}
                </ul>
              </div>
            )}
            {(s?.missing_data ?? live?.missingData ?? []).length > 0 && (
              <p className="border-t border-line px-4 py-2.5 text-[11px] text-fg-faint">Missing data: {(s?.missing_data ?? live?.missingData ?? []).join(", ")}</p>
            )}
            {!s && !live && <EmptyState title="No snapshot yet" />}
          </Card>

          <Card>
            <SecurityPanel sec={sec} />
          </Card>

          <Card>
            <CardHeader title="Trading pairs" />
            <ul className="divide-y divide-line text-sm">
              {pairs.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2">
                  <span>
                    {p.dex_id ?? "dex"} · {t.symbol}/{p.quote_symbol ?? "?"} {p.is_primary && <Badge tone="info">primary</Badge>}
                  </span>
                  <span className="num text-xs text-fg-muted" title={p.pair_address}>{formatUsd(p.liquidity_usd)} · {shortAddress(p.pair_address)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Disclaimer />
        </div>
      </div>
    </>
  );
}
