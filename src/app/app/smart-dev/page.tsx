import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { ProvenLaunchList } from "@/components/app/proven-launches";
import { Badge, buttonClass, Card, cx, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, ScoreRing, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { devLeaderboard, devStats, LAUNCHPAD_CHAINS, provenDevDeploys } from "@/lib/data/launchpad";
import { formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { launchReadout } from "@/lib/launchpad/readout";
import { PROVEN_DEV_SCORE } from "@/lib/launchpad/pump";
import { devReputation, REPUTATION } from "@/lib/devs/profile";

export const metadata: Metadata = { title: "Proven Devs" };

const PROVEN_SCORE = PROVEN_DEV_SCORE;
const FREE_PREVIEW = 5;

const WINDOWS = { "1h": 1, "6h": 6, "24h": 24 } as const;
type Window = keyof typeof WINDOWS;
const VIEWS = { all: "All", clear: "Looks clear", hide_avoid: "Hide Avoid" } as const;
type View = keyof typeof VIEWS;

export default async function ProvenDevsPage({ searchParams }: PageProps<"/app/smart-dev">) {
  const user = await requirePageUser("/app/smart-dev");
  const sp = await searchParams;
  const win: Window = typeof sp.window === "string" && sp.window in WINDOWS ? (sp.window as Window) : "24h";
  const view: View = typeof sp.show === "string" && sp.show in VIEWS ? (sp.show as View) : "all";
  const ent = await getEntitlements(user.id);
  const header = (
    <PageHeader
      title="Proven Devs"
      description="Who launches the coins: new coins from creators whose earlier pump.fun and LetsBonk launches migrated, and every developer's record. Open a developer for their full history and linked wallets, or a coin for its contract security and holders."
      actions={<AutoRefresh seconds={30} />}
    />
  );
  const chains = LAUNCHPAD_CHAINS.filter((c) => ent.features.chains.includes(c));
  if (!chains.length) return <>{header}<UpgradeGate feature="Launchpad data (Solana)" /></>;

  const full = ent.features.smart_money;
  const [devs, deploys, stats] = await Promise.all([
    devLeaderboard(full ? 100 : FREE_PREVIEW, chains),
    full ? provenDevDeploys(PROVEN_SCORE, chains, 60, WINDOWS[win]) : Promise.resolve([]),
    devStats(chains),
  ]);

  const read = deploys.map((t) => ({ t, status: launchReadout(t).status }));
  const counts = { clear: 0, caution: 0, avoid: 0, pending: 0, unchecked: 0 };
  for (const x of read) counts[x.status]++;
  const shown = read.filter((x) => (view === "clear" ? x.status === "clear" : view === "hide_avoid" ? x.status !== "avoid" : true)).map((x) => x.t);
  const href = (o: { window?: Window; show?: View }) => {
    const q = new URLSearchParams();
    const w = o.window ?? win;
    const v = o.show ?? view;
    if (w !== "24h") q.set("window", w);
    if (v !== "all") q.set("show", v);
    return `/app/smart-dev${q.size ? `?${q}` : ""}`;
  };
  const chip = (active: boolean) => cx("rounded-md border px-2.5 py-1 text-xs", active ? "border-up/60 bg-up/10 text-fg" : "border-line text-fg-muted hover:text-fg");

  return (
    <>
      {header}
      <Card>
        <CardHeader
          title="Proven dev launches"
          subtitle={`New coins from devs with a score of ${PROVEN_SCORE}+ and 2+ launches, newest first. Each one says whether it looks clear, and why.`}
        />
        {!full ? (
          <EmptyState title="Elite feature" body="See new coins the moment a dev with a strong record launches one." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <nav aria-label="Time window" className="flex gap-1.5">
                {(Object.keys(WINDOWS) as Window[]).map((w) => (
                  <Link key={w} href={href({ window: w })} className={chip(w === win)} aria-current={w === win ? "page" : undefined}>Last {w}</Link>
                ))}
              </nav>
              <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
              <nav aria-label="Filter launches" className="flex gap-1.5">
                {(Object.keys(VIEWS) as View[]).map((v) => (
                  <Link key={v} href={href({ show: v })} className={chip(v === view)} aria-current={v === view ? "page" : undefined}>{VIEWS[v]}</Link>
                ))}
              </nav>
              <span className="ml-auto text-xs text-fg-muted">
                {deploys.length} launch{deploys.length === 1 ? "" : "es"} ·{" "}
                <span className="text-pos">{counts.clear} clear</span> · <span className="text-warn">{counts.caution} caution</span> ·{" "}
                <span className="text-down">{counts.avoid} avoid</span>{counts.pending + counts.unchecked ? <> · {counts.pending + counts.unchecked} not checked yet</> : null}
              </span>
            </div>
            {deploys.length === 0 ? (
              <EmptyState title={`No proven dev launched in the last ${win}`} body="Launches show up within seconds. Turn on the proven-dev alert to get them on Telegram." />
            ) : shown.length === 0 ? (
              <EmptyState title="Nothing matches this filter" body="Try All, or a longer time window." />
            ) : (
              <ProvenLaunchList rows={shown} />
            )}
            <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
              <span className="text-pos">Looks clear</span>: the scam check passed and nothing below stood out; it is not a promise.{" "}
              <span className="text-warn">Caution</span>: a dev sale, a bundle or snipers holding 10–30%, or down 50%+ from its peak.{" "}
              <span className="text-down">Avoid</span>: the scam check failed, the dev sold 5%+, a bundle holds 20%+ or snipers 30%+. A dev&apos;s record does not predict the next coin.
            </p>
          </>
        )}
      </Card>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Dev leaderboard"
            subtitle={`${stats?.devs ?? 0} creators recorded · ${stats?.proven ?? 0} with score ${PROVEN_SCORE}+ · ${stats?.backfilled ?? 0} history-checked`}
          />
          {devs.length === 0 ? (
            <EmptyState
              title="No ranked devs yet"
              body="Devs appear once they have two or more recorded launches. The feeds record every new pump.fun and LetsBonk token, and Solana creators of tokens that reach 50% of the curve get their launch history checked automatically, so this fills within hours of the worker starting."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-terminal">
                <thead>
                  <tr>
                    <th>Score</th><th>Dev wallet</th><th className="text-right">Launches</th><th className="text-right">Migrated</th>
                    <th className="text-right" title="Migrations whose market cap kept half its value an hour later and that the dev did not dump">Held</th>
                    <th className="text-right" title="Best market cap after migration (not the curve peak)">Best mcap</th><th>Last launch</th><th>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {devs.map((d) => (
                    <tr key={d.creator}>
                      <td>
                        <span className="flex items-center gap-1.5">
                          <ScoreRing score={d.score} size={32} label="Dev score" />
                          <Badge tone={REPUTATION[devReputation(d)].tone} title={`${REPUTATION[devReputation(d)].text} Confidence: ${d.confidence ?? "not set"}.`}>{REPUTATION[devReputation(d)].label}</Badge>
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          <ChainBadge chain="solana" />
                          <Link href={`/app/smart-dev/${d.creator}`} className="num hover:text-up" title="Open the developer's profile">{shortAddress(d.creator, 5)}</Link>
                          {d.linked_wallets > 1 && <Badge tone="info" title="Wallets funded by the same wallet, scored as one dev">+{d.linked_wallets - 1} linked</Badge>}
                        </span>
                      </td>
                      <td className="num text-right">{d.launches}</td>
                      <td className="num text-right">{d.migrated} <span className="text-fg-faint">({Math.round((d.migrated / d.launches) * 100)}%)</span></td>
                      <td className="num text-right">{d.held ?? "—"}</td>
                      <td className="num text-right">{formatUsd(d.best_market_cap_usd)}</td>
                      <td className="text-xs text-fg-muted">{timeAgo(d.last_launch_at)}</td>
                      <td>{d.backfilled_at ? <Badge title="Earlier launches found in on-chain history">history checked</Badge> : <Badge tone="warn" title="Only launches seen live are counted so far">live only</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!full && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
              <span className="text-fg-muted">Showing the top {FREE_PREVIEW}. Elite unlocks the full leaderboard and live deploys by proven devs.</span>
              <Link href="/app/billing" className={buttonClass("primary", "sm")}>Upgrade</Link>
            </div>
          )}
        </Card>
      </div>
      <div className="mt-4">
        <Notice title="How the dev score works">
          Each launch counts by what happened after it: migrated and still worth half its migration value an hour later (full), migrated then
          collapsed (less), dev sold 5%+ (little), never migrated (nothing). Recent launches weigh more (a launch counts half after 30 days), small
          samples are pulled toward the launchpad base rate, and the best market cap after migration adds up to 20 points. Wallets funded by the
          same wallet are scored together, so a fresh wallet keeps its old record. Devs without a migration that held are capped at 40. A good
          record does not mean the next launch will do well.
        </Notice>
      </div>
    </>
  );
}
