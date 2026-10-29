import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { LaunchCheckBadge } from "@/components/app/launchpad";
import { CopyAddress } from "@/components/app/token-actions";
import { Badge, buttonClass, Card, cx, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, ScoreRing, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { devLeaderboard, devStats, LAUNCHPAD_CHAINS, provenDevDeploys, type LaunchRow } from "@/lib/data/launchpad";
import { formatAge, formatNumber, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { launchpadName, launchpadUrl } from "@/lib/launchpad/names";
import { PROVEN_DEV_SCORE } from "@/lib/launchpad/pump";
import { devReputation, REPUTATION } from "@/lib/devs/profile";

export const metadata: Metadata = { title: "Proven Devs" };

const PROVEN_SCORE = PROVEN_DEV_SCORE;
const FREE_PREVIEW = 5;

/** Muted below `warn`, amber from `warn`, red from `bad` (percent of supply). */
const pctTone = (v: number | null, warn: number, bad: number) => (v === null ? "text-fg-faint" : v >= bad ? "text-down" : v >= warn ? "text-warn" : "text-fg-muted");

/** Coins still on their bonding curve have no token page yet: open the full check by address instead. */
const coinHref = (t: LaunchRow) => (t.token_id ? `/app/token/${t.chain}/${t.token_id}` : `/app/check?q=${encodeURIComponent(t.mint)}`);

/** Phone layout of the launch table: one card per coin with the same facts. */
function LaunchCards({ rows }: { rows: LaunchRow[] }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {rows.map((t) => {
        const padUrl = launchpadUrl(t.pool, t.mint);
        return (
          <li key={t.mint} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Link href={coinHref(t)} className="truncate font-semibold hover:text-up">{t.symbol ?? shortAddress(t.mint)}</Link>
                <ChainBadge chain={t.chain} />
                <span className="num text-xs text-fg-faint">{formatAge(t.created_at)}</span>
              </span>
              <span className="num text-sm">{formatUsd(t.market_cap_usd)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <LaunchCheckBadge t={t} />
              {t.dev_sold_pct !== null && <Badge tone="down">dev sold {Number(t.dev_sold_pct).toFixed(1)}%</Badge>}
              <Link href={`/app/smart-dev/${t.creator}`} className="text-fg-muted hover:text-up">dev {t.dev_migrated ?? 0}/{t.dev_launches ?? 0} migrated →</Link>
              {t.bundle_pct !== null && <span className={pctTone(t.bundle_pct, 10, 20)}>bundle {Number(t.bundle_pct).toFixed(1)}%</span>}
              {t.sniper_pct !== null && <span className={pctTone(t.sniper_pct, 15, 30)}>snipers {t.sniper_wallets ?? 0} · {Number(t.sniper_pct).toFixed(1)}%</span>}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <CopyAddress address={t.mint} />
              {padUrl && <a href={padUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-faint hover:text-fg">{launchpadName(t.pool)} ↗</a>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function LaunchTable({ rows }: { rows: LaunchRow[] }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="table-terminal">
        <thead>
          <tr>
            <th>Coin</th><th>Age</th><th className="text-right">Mcap</th><th className="text-right">Dev record</th>
            <th className="text-right" title="What the creator bought at launch">Dev buy</th>
            <th className="text-right" title="% of supply bought in the creation block by other wallets">Bundle</th>
            <th className="text-right" title="Wallets buying in the first 10 seconds, and their % of supply">Snipers</th>
            <th>Scam check</th><th>Contract</th><th>Where</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const padUrl = launchpadUrl(t.pool, t.mint);
            return (
              <tr key={t.mint}>
                <td>
                  <span className="flex items-center gap-2">
                    <Link href={coinHref(t)} className="font-semibold hover:text-up">{t.symbol ?? shortAddress(t.mint)}</Link>
                    <ChainBadge chain={t.chain} />
                    {t.dev_sold_pct !== null && <Badge tone="down" title="The creator sold their own coin (seen live)">dev sold {Number(t.dev_sold_pct).toFixed(1)}%</Badge>}
                  </span>
                </td>
                <td className="num text-fg-muted">{formatAge(t.created_at)}</td>
                <td className="num text-right">{formatUsd(t.market_cap_usd)}</td>
                <td className="num text-right">
                  <Link href={`/app/smart-dev/${t.creator}`} className="hover:text-up" title="Open the developer's profile">
                    {t.dev_migrated ?? 0}/{t.dev_launches ?? 0} migrated
                    {t.dev_score !== null && <span className="text-fg-faint"> · {t.dev_score}</span>}
                  </Link>
                </td>
                <td className="num text-right text-fg-muted">{t.initial_buy_sol !== null ? `${formatNumber(Number(t.initial_buy_sol), 2)} SOL` : "—"}</td>
                <td className={cx("num text-right", pctTone(t.bundle_pct, 10, 20))}>{t.bundle_pct !== null ? `${Number(t.bundle_pct).toFixed(1)}%` : "—"}</td>
                <td className={cx("num text-right", pctTone(t.sniper_pct, 15, 30))}>{t.sniper_pct !== null ? `${t.sniper_wallets ?? 0} · ${Number(t.sniper_pct).toFixed(1)}%` : "—"}</td>
                <td><LaunchCheckBadge t={t} /></td>
                <td className="text-[11px]"><CopyAddress address={t.mint} /></td>
                <td className="text-fg-muted">
                  {padUrl ? <a href={padUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-fg">{launchpadName(t.pool)} ↗</a> : launchpadName(t.pool)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ProvenDevsPage() {
  const user = await requirePageUser("/app/smart-dev");
  const ent = await getEntitlements(user.id);
  const header = (
    <PageHeader
      title="Proven Devs"
      description="Who launches the coins: new coins from creators whose earlier pump.fun and LetsBonk launches migrated, and every developer's record. Open a developer for their full history and linked wallets, or a coin for its Coin Check."
      actions={<AutoRefresh seconds={30} />}
    />
  );
  const chains = LAUNCHPAD_CHAINS.filter((c) => ent.features.chains.includes(c));
  if (!chains.length) return <>{header}<UpgradeGate feature="Launchpad data (Solana)" /></>;

  const full = ent.features.smart_money;
  const [devs, deploys, stats] = await Promise.all([
    devLeaderboard(full ? 100 : FREE_PREVIEW, chains),
    full ? provenDevDeploys(PROVEN_SCORE, chains) : Promise.resolve([]),
    devStats(chains),
  ]);

  return (
    <>
      {header}
      <Card>
        <CardHeader title="Proven dev launches" subtitle={`Last 24h, newest first · dev score ${PROVEN_SCORE}+ with 2+ launches`} />
        {!full ? (
          <EmptyState title="Elite feature" body="See new coins the moment a dev with a strong record launches one." />
        ) : deploys.length === 0 ? (
          <EmptyState title="No proven dev launched in the last 24h" body="Launches show up within seconds. Turn on the proven-dev alert to get them on Telegram." />
        ) : (
          <>
            <LaunchCards rows={deploys} />
            <LaunchTable rows={deploys} />
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
