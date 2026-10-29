import type { Metadata } from "next";
import Link from "next/link";
import { DeleteRule, MarkAllRead, NewAlertForm, PresetSwitch, RuleToggle } from "@/components/app/alert-forms";
import { Card, CardHeader, cx, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { ALERT_PRESETS, presetLock } from "@/lib/alerts/presets";
import { ALERT_LABELS, describeAlertParams, type AlertType } from "@/lib/alerts/rules";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid, queryOne, withUser } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };

/** Alerts are grouped by the feature they come from. */
const FEATURES = [
  { key: "early", title: "Early Coins", href: "/app" },
  { key: "devs", title: "Proven Devs", href: "/app/smart-dev" },
  { key: "wallets", title: "Smart Wallets", href: "/app/smart-money" },
  { key: "watchlist", title: "Watchlist", href: "/app/watchlist" },
] as const;

export default async function AlertsPage({ searchParams }: PageProps<"/app/alerts">) {
  const user = await requirePageUser("/app/alerts");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const presetId = typeof sp.tokenId === "string" && isUuid(sp.tokenId) ? sp.tokenId : null;
  const presetToken = presetId ? await queryOne<{ id: string; chain: string; symbol: string; name: string; logo_url: string | null }>("SELECT id, chain, symbol, name, logo_url FROM token_assets WHERE id = $1", [presetId]) : null;

  const [data, profile] = await Promise.all([
    withUser(user.id, async (tx) => ({
      rules: await tx.query<{ id: string; name: string; rule_type: AlertType; params: Record<string, unknown>; channels: string[]; is_active: boolean; last_triggered_at: Date | null; token_id: string | null; chain: string | null }>(
        "SELECT id, name, rule_type, params, channels, is_active, last_triggered_at, token_id, chain FROM alert_rules ORDER BY created_at DESC",
      ),
      inbox: await tx.query<{ id: string; title: string; body: string; link: string | null; created_at: Date; read_at: Date | null }>(
        "SELECT id, title, body, link, created_at, read_at FROM notifications WHERE channel = 'in_app' ORDER BY created_at DESC LIMIT 30",
      ),
      wallets: await tx.query<{ id: string; label: string }>(
        "SELECT w.id, COALESCE(t.custom_label, w.label, w.address) AS label FROM user_tracked_wallets t JOIN wallet_profiles w ON w.id = t.wallet_id",
      ),
    })),
    queryOne<{ notify_telegram: boolean; telegram_chat_id: string | null }>("SELECT notify_telegram, telegram_chat_id FROM profiles WHERE user_id = $1", [user.id]),
  ]);

  const telegramAllowed = ent.features.alert_channels.includes("telegram");
  const telegramOn = telegramAllowed && Boolean(profile?.notify_telegram && profile.telegram_chat_id);
  const channels = telegramOn ? ["in_app", "telegram"] : ["in_app"];
  const presetRule = (key: string) => data.rules.find((r) => r.params.preset === key) ?? null;
  const custom = data.rules.filter((r) => typeof r.params.preset !== "string");
  // Several rules can fire on the same event; show it once.
  const inbox = data.inbox.filter((n, i, all) => all.findIndex((x) => x.title === n.title && x.link === n.link) === i).slice(0, 20);

  return (
    <>
      <PageHeader title="Alerts" description="One place for everything SOLME can tell you about. Each event arrives once, says why it fired, and has mute buttons on Telegram. Quiet hours and the digest are in Settings." />

      <Card>
        <CardHeader
          title="What to alert"
          subtitle={
            telegramOn ? "Delivered in-app and to Telegram" : telegramAllowed ? "Delivered in-app · connect Telegram in Account Settings to get them on your phone" : "Delivered in-app · Telegram is on Pro and Elite"
          }
          action={telegramAllowed && !telegramOn ? <Link href="/app/settings" className="text-xs text-up hover:underline">Connect Telegram →</Link> : undefined}
        />
        {FEATURES.map((f) => (
        <section key={f.key} aria-labelledby={`alerts-${f.key}`} className="border-t border-line first:border-t-0">
        <h3 id={`alerts-${f.key}`} className="flex items-center justify-between bg-ink-850 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          {f.title}
          <Link href={f.href} className="font-normal normal-case tracking-normal text-fg-faint hover:text-up">Open →</Link>
        </h3>
        <ul className="divide-y divide-line">
          {ALERT_PRESETS.filter((p) => p.feature === f.key).map((p) => {
            const rule = presetRule(p.key);
            return (
              <li key={p.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className={cx("text-sm", rule?.is_active ? "text-fg" : "text-fg-muted")}>{p.title}</div>
                  <div className="text-xs text-fg-faint">{p.detail}{rule?.last_triggered_at ? ` · last fired ${timeAgo(rule.last_triggered_at)}` : ""}</div>
                </div>
                <PresetSwitch
                  preset={{ key: p.key, title: p.title, rule_type: p.rule_type, params: p.params }}
                  ruleId={rule?.id ?? null}
                  active={Boolean(rule?.is_active)}
                  channels={channels}
                  locked={presetLock(p, ent)}
                />
              </li>
            );
          })}
        </ul>
        </section>
        ))}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Recent alerts" action={data.inbox.some((n) => !n.read_at) ? <MarkAllRead /> : undefined} />
        {inbox.length === 0 ? (
          <EmptyState title="Nothing yet" body="Alerts you receive appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {inbox.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "/app/alerts"} className={cx("block px-4 py-2.5 hover:bg-ink-750", n.read_at && "opacity-60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cx("truncate text-sm", !n.read_at && "font-medium")}>{n.title}</span>
                    <span className="num shrink-0 text-xs text-fg-faint">{timeAgo(n.created_at)}</span>
                  </div>
                  <div className="truncate text-xs text-fg-faint">{n.body}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="card group mt-4" open={Boolean(presetToken)}>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm text-fg-muted hover:text-fg">
          <span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span> Custom rules <span className="text-fg-faint">({custom.length} · {data.rules.length}/{ent.features.max_alert_rules} rules used)</span>
        </summary>
        <div className="border-t border-line p-4">
          <NewAlertForm
            presetToken={presetToken}
            wallets={data.wallets}
            allowedChannels={ent.features.alert_channels}
            defaultChannels={channels}
            emailVerified={user.emailVerified}
            walletAlertsAllowed={ent.features.max_tracked_wallets > 0}
          />
        </div>
        {custom.length > 0 && (
          <div className="overflow-x-auto border-t border-line">
            <table className="table-terminal">
              <thead><tr><th>On</th><th>Rule</th><th>Condition</th><th className="text-right">Last fired</th><th /></tr></thead>
              <tbody>
                {custom.map((r) => (
                  <tr key={r.id}>
                    <td><RuleToggle id={r.id} active={r.is_active} /></td>
                    <td>{r.name} <span className="text-xs text-fg-faint">{ALERT_LABELS[r.rule_type]}</span></td>
                    <td className="num text-xs text-fg-muted">{describeAlertParams(r.rule_type, r.params)}</td>
                    <td className="text-right text-xs text-fg-faint">{timeAgo(r.last_triggered_at)}</td>
                    <td className="text-right"><DeleteRule id={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </>
  );
}
