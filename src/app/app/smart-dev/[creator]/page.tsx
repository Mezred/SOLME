import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddress } from "@/components/app/token-actions";
import { Badge, Card, CardHeader, cx, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { CHAINS, normalizeAddress } from "@/lib/chains";
import { loadDevProfile, OUTCOME, REPUTATION, type Outcome } from "@/lib/devs/profile";
import { formatAge, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { launchpadName } from "@/lib/launchpad/names";

export const metadata: Metadata = { title: "Developer" };

const OUTCOME_CLS: Record<Outcome, string> = { held: "text-pos", collapsed: "text-warn", migrated: "text-fg", curve: "text-fg-muted", failed: "text-fg-faint" };
const OUTCOME_ICON: Record<Outcome, string> = { held: "✓", collapsed: "↘", migrated: "→", curve: "…", failed: "–" };

/** One developer in plain language: who they are, what their coins did, what they sold, and how sure SOLME is. */
export default async function DevProfilePage({ params }: PageProps<"/app/smart-dev/[creator]">) {
  const { creator: raw } = await params;
  await requirePageUser(`/app/smart-dev/${raw}`);
  const creator = normalizeAddress("solana", raw);
  if (!creator) notFound();
  const p = await loadDevProfile(creator);
  if (!p) notFound();
  const { dev } = p;
  const rep = REPUTATION[p.reputation];
  const counts = p.launches.reduce<Record<Outcome, number>>((m, l) => ({ ...m, [l.outcome]: (m[l.outcome] ?? 0) + 1 }), { held: 0, collapsed: 0, migrated: 0, curve: 0, failed: 0 });

  return (
    <>
      <PageHeader
        title={`Developer ${shortAddress(creator, 5)}`}
        badge={<Badge tone={rep.tone}>{rep.label}</Badge>}
        description={rep.text}
        actions={<a href={CHAINS.solana.explorerAddress(creator)} target="_blank" rel="noopener noreferrer" className="text-sm text-fg-muted hover:text-fg">Explorer ↗</a>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Launches found" value={dev.launches} sub={dev.linked_wallets > 1 ? `across ${dev.linked_wallets} linked wallets` : "from this wallet"} />
        <Stat label="Migrated" value={dev.migrated} sub={dev.launches ? `${Math.round((dev.migrated / dev.launches) * 100)}% of launches` : undefined} />
        <Stat label="Migrated and held" value={dev.held ?? "—"} sub="kept half their value an hour later" tone={(dev.held ?? 0) > 0 ? "up" : undefined} />
        <Stat label="Dev score" value={dev.score ?? "—"} sub={dev.confidence ? `${dev.confidence} confidence` : "not scored"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Launch history" subtitle={`Newest first · ${counts.held} held, ${counts.collapsed} collapsed after migrating, ${counts.failed} never migrated${counts.curve ? `, ${counts.curve} still on the curve` : ""}`} />
          {p.launches.length === 0 ? (
            <EmptyState title="No launches recorded" />
          ) : (
            <ol className="divide-y divide-line">
              {p.launches.map((l) => (
                <li key={l.mint} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className={cx("num w-3 font-bold", OUTCOME_CLS[l.outcome])} aria-hidden="true">{OUTCOME_ICON[l.outcome]}</span>
                  <Link href={l.token_id ? `/app/token/solana/${l.token_id}` : `/app/token/solana/${l.mint}`} className="font-semibold hover:text-up">{l.symbol ?? shortAddress(l.mint)}</Link>
                  <span className="text-xs text-fg-faint">{launchpadName(l.pool)} · {formatAge(l.created_at)} ago{l.creator !== creator ? ` · from linked wallet ${shortAddress(l.creator)}` : ""}</span>
                  <span className={cx("ml-auto text-xs", OUTCOME_CLS[l.outcome])}>{OUTCOME[l.outcome]}</span>
                  <span className="w-full pl-6 text-[11px] text-fg-faint">
                    {l.mcap_at_migration_usd ? `Market cap at migration ${formatUsd(l.mcap_at_migration_usd)}${l.held_mcap_usd !== null ? `, an hour later ${formatUsd(l.held_mcap_usd)}` : ""}` : l.peak_market_cap_usd ? `Peak seen ${formatUsd(l.peak_market_cap_usd)}` : "No market data recorded"}
                    {l.dev_sold_pct !== null && <span className={(l.dev_sold_pct ?? 0) >= 5 ? "text-down" : "text-warn"}> · dev sold {l.dev_sold_pct.toFixed(1)}% of supply{l.first_sell_at ? ` (first sale ${timeAgo(l.first_sell_at)})` : ""}</span>}
                    {l.check_passed === false && <span className="text-down"> · failed the launch scam check</span>}
                    {l.source === "backfill" && " · found in on-chain history"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Wallets" />
            <div className="space-y-3 px-4 py-3 text-xs">
              <div>
                <div className="text-fg-faint">Creator wallet</div>
                <CopyAddress address={creator} />
              </div>
              {p.linked.length > 0 ? (
                <div>
                  <div className="text-fg-faint">Linked wallets <Badge tone="warn" title="Deduced from on-chain funding, not proven">inferred</Badge></div>
                  <p className="mt-1 text-fg-muted">
                    These wallets were first funded by the same wallet ({shortAddress(dev.funder, 4)}), which funded {p.funderShared} creators in total. That usually
                    means one person or team, but a shared funder can also be a service. Their launches are counted in this record.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {p.linked.map((l) => (
                      <li key={l.creator} className="flex items-center justify-between gap-2">
                        <Link href={`/app/smart-dev/${l.creator}`} className="num hover:text-up">{shortAddress(l.creator, 5)}</Link>
                        <span className="text-fg-faint">{l.own_launches ?? 0} launches · {l.own_migrated ?? 0} migrated · {timeAgo(l.last_launch_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-fg-muted">
                  {p.funderHub
                    ? `Its first funder also funded ${p.funderShared} other creators: an exchange or service, so it links nobody.`
                    : dev.funder ? "No other creator shares its first funder." : "First funder not traced yet."}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Behaviour" />
            <ul className="space-y-2 px-4 py-3 text-xs text-fg-muted">
              <li>
                <b className="text-fg">Selling their own coins:</b>{" "}
                {p.watchedSells === 0
                  ? "not observed: SOLME only sees a dev's sales on launches it watched live."
                  : p.soldEarly > 0
                    ? <span className="text-warn">sold 5%+ of supply in {p.soldEarly} of {p.watchedSells} launches watched live.</span>
                    : `no sale of 5%+ seen in ${p.watchedSells} launch${p.watchedSells > 1 ? "es" : ""} watched live.`}
              </li>
              <li><b className="text-fg">Best market cap after migrating:</b> {formatUsd(dev.best_market_cap_usd)}</li>
              <li><b className="text-fg">Last launch:</b> {timeAgo(dev.last_launch_at)}</li>
            </ul>
          </Card>

          <Notice title="Coverage and limits">
            {dev.backfilled_at ? "Earlier launches were found in on-chain history" : "Only launches seen live are counted so far (history not checked yet)"}. Confidence is {dev.confidence ?? "not set"}: it reflects how much recent history the score rests on.
            A failed coin is common on launchpads and is not evidence of bad intent; a good record does not make the next launch safe. Open any coin for its evidence.
          </Notice>
        </div>
      </div>
    </>
  );
}
