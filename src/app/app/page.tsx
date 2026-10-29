import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PresetSwitch } from "@/components/app/alert-forms";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { TelegramConnect } from "@/components/app/settings-forms";
import { LaunchCheckBadge } from "@/components/app/launchpad";
import { Card, CardHeader, ChainBadge, EmptyState, Freshness, PageHeader, Stat } from "@/components/ui";
import { ALERT_PRESETS, presetLock } from "@/lib/alerts/presets";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query, queryOne } from "@/lib/db";
import { LAUNCHPAD_CHAINS, provenDevDeploys, type LaunchRow } from "@/lib/data/launchpad";
import { latestSnapshotTime } from "@/lib/data/tokens";
import { formatAge, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { PROVEN_DEV_SCORE } from "@/lib/launchpad/pump";
import { WATCH_MIN_SCORE } from "@/lib/wallets/smart-money";

export const metadata: Metadata = { title: "Overview" };

/** The two alerts most traders want first (see src/lib/alerts/presets.ts). */
const ONBOARDING_PRESETS = ["proven_dev", "smart_buy"];

interface SmartBuy {
  id: string;
  chain: string;
  token_address: string;
  symbol: string | null;
  token_id: string | null;
  sol: number | null;
  block_time: Date;
}

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs text-up hover:underline">
      {children} →
    </Link>
  );
}

/** Home of the terminal: one glance at every feature, each card linking to its full page. */
export default async function OverviewPage() {
  const user = await requirePageUser();
  const ent = await getEntitlements(user.id);
  const chains = LAUNCHPAD_CHAINS.filter((c) => ent.features.chains.includes(c));
  const proven = ent.features.smart_money && chains.length > 0;
  const [launches, latest, buys, buyCount, alerts] = await Promise.all([
    proven ? provenDevDeploys(PROVEN_DEV_SCORE, chains) : Promise.resolve([] as LaunchRow[]),
    latestSnapshotTime(),
    query<SmartBuy>(
      `SELECT x.id, x.chain, x.token_address, COALESCE(ta.symbol, x.token_symbol) AS symbol, ta.id AS token_id, (x.raw->>'sol')::numeric AS sol, x.block_time
         FROM wallet_transactions x JOIN wallet_scores s ON s.wallet_id = x.wallet_id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > now() - interval '24 hours' AND s.score >= $1 AND NOT s.bot_like
        ORDER BY x.block_time DESC LIMIT 5`,
      [WATCH_MIN_SCORE],
    ),
    queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM wallet_transactions x JOIN wallet_scores s ON s.wallet_id = x.wallet_id
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > now() - interval '24 hours' AND s.score >= $1 AND NOT s.bot_like`,
      [WATCH_MIN_SCORE],
    ),
    queryOne<{ active: number; fired24h: number }>(
      `SELECT (SELECT count(*)::int FROM alert_rules WHERE user_id = $1 AND is_active) AS active,
              (SELECT count(*)::int FROM alert_rules WHERE user_id = $1 AND last_triggered_at > now() - interval '24 hours') AS fired24h`,
      [user.id],
    ),
  ]);
  const [profile, presetRules] = await Promise.all([
    queryOne<{ telegram_chat_id: string | null; notify_telegram: boolean }>("SELECT telegram_chat_id, notify_telegram FROM profiles WHERE user_id = $1", [user.id]),
    query<{ id: string; is_active: boolean; preset: string }>("SELECT id, is_active, params->>'preset' AS preset FROM alert_rules WHERE user_id = $1 AND params ? 'preset'", [user.id]),
  ]);
  const telegramAllowed = ent.features.alert_channels.includes("telegram");
  const telegramOn = telegramAllowed && Boolean(profile?.telegram_chat_id && profile.notify_telegram);
  const setup = { telegram: telegramOn, alerts: (alerts?.active ?? 0) > 0 };
  const lastHour = launches.filter((t) => Date.now() - new Date(t.created_at).getTime() < 60 * 60_000).length;

  return (
    <>
      <PageHeader title="Overview" description="Everything at a glance: proven-dev launches, what smart wallets are buying and your alerts." badge={<Freshness at={latest} label="Data" />} actions={<AutoRefresh seconds={60} />} />

      {!(setup.telegram && setup.alerts) && (
        <Card className="mb-4">
          <CardHeader title="Get set up" subtitle="Two steps and SOLME comes to you: alerts land on your phone within seconds." />
          <ol className="divide-y divide-line">
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <span className={setup.telegram ? "text-up" : "text-fg"}>{setup.telegram ? "✓" : "1."} Connect Telegram</span>
                <span className="block text-xs text-fg-faint">Alerts with the contract to copy, the scam check and 🔕 mute buttons. Send the bot any contract to check it.</span>
              </div>
              {setup.telegram ? (
                <span className="text-xs text-up">Connected</span>
              ) : telegramAllowed ? (
                <TelegramConnect />
              ) : (
                <Link href="/app/billing" className="text-xs text-up hover:underline">Telegram alerts are on Pro →</Link>
              )}
            </li>
            {ONBOARDING_PRESETS.map((key) => {
              const p = ALERT_PRESETS.find((x) => x.key === key)!;
              const rule = presetRules.find((r) => r.preset === key);
              return (
                <li key={key} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <span className={rule?.is_active ? "text-up" : "text-fg"}>{rule?.is_active ? "✓ " : ""}{p.title}</span>
                    <span className="block text-xs text-fg-faint">{p.detail}</span>
                  </div>
                  <PresetSwitch
                    preset={{ key: p.key, title: p.title, rule_type: p.rule_type, params: p.params }}
                    ruleId={rule?.id ?? null}
                    active={Boolean(rule?.is_active)}
                    channels={telegramOn ? ["in_app", "telegram"] : ["in_app"]}
                    locked={presetLock(p, ent)}
                  />
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Proven dev launches" value={proven ? lastHour : "—"} sub="last hour" tone={lastHour ? "up" : undefined} />
        <Stat label="In 24h" value={proven ? launches.length : "—"} sub={`dev score ${PROVEN_DEV_SCORE}+`} />
        <Stat label="Smart-wallet buys" value={buyCount?.n ?? 0} sub="last 24h" />
        <Stat label="Your alerts" value={alerts?.active ?? 0} sub={`${alerts?.fired24h ?? 0} fired in 24h`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Proven dev launches" subtitle="Newest coins from devs whose earlier launches migrated" action={<More href="/app/smart-dev">Open Proven Devs</More>} />
          {!proven ? (
            <EmptyState title="Elite feature" body="See new coins the moment a dev with a strong record launches one." />
          ) : launches.length === 0 ? (
            <EmptyState title="No proven dev launched in 24h" body="New launches show up within seconds." />
          ) : (
            <ul className="divide-y divide-line">
              {launches.slice(0, 5).map((t) => (
                <li key={t.mint} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link href={t.token_id ? `/app/token/${t.chain}/${t.token_id}` : `/app/check?q=${encodeURIComponent(t.mint)}`} className="font-semibold hover:text-up">
                    {t.symbol ?? shortAddress(t.mint)}
                  </Link>
                  <ChainBadge chain={t.chain} />
                  <LaunchCheckBadge t={t} />
                  <span className="num ml-auto text-fg-muted">{formatUsd(t.market_cap_usd)}</span>
                  <span className="num w-12 text-right text-xs text-fg-faint">{formatAge(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Smart wallets" subtitle={`Latest buys by wallets scoring ${WATCH_MIN_SCORE}+`} action={<More href="/app/smart-money">Open Smart Wallets</More>} />
          {buys.length === 0 ? (
            <EmptyState title="No smart-wallet buys in 24h" body="Buys show up about 90 seconds after they land on-chain." />
          ) : (
            <ul className="divide-y divide-line">
              {buys.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {b.token_id ? (
                    <Link href={`/app/token/${b.chain}/${b.token_id}`} className="font-semibold hover:text-up">{b.symbol ?? shortAddress(b.token_address)}</Link>
                  ) : (
                    <span className="font-semibold">{b.symbol ?? shortAddress(b.token_address)}</span>
                  )}
                  <ChainBadge chain={b.chain} />
                  {b.sol !== null && <span className="num ml-auto text-fg-muted">{b.sol.toFixed(2)} SOL</span>}
                  <span className="num w-16 text-right text-xs text-fg-faint">{timeAgo(b.block_time)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/screener" className="card flex-1 px-4 py-3 text-sm hover:border-up">
          <span className="font-semibold text-fg">Screener</span>
          <span className="block text-xs text-fg-faint">Filter every DEX pair, save your templates</span>
        </Link>
        <Link href="/app/check" className="card flex-1 px-4 py-3 text-sm hover:border-up">
          <span className="font-semibold text-fg">Check a coin</span>
          <span className="block text-xs text-fg-faint">Paste a contract for the full scam check</span>
        </Link>
        <Link href="/app/alerts" className="card flex-1 px-4 py-3 text-sm hover:border-up">
          <span className="font-semibold text-fg">Set an alert</span>
          <span className="block text-xs text-fg-faint">Proven devs, wallet buys, price, volume</span>
        </Link>
      </div>
      <p className="mt-4 text-[11px] text-fg-faint">Research, not advice. Size every memecoin trade so a total loss is acceptable.</p>
    </>
  );
}
