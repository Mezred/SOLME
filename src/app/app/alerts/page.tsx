import type { Metadata } from "next";
import Link from "next/link";
import { DeleteRule, MarkAllRead, NewAlertForm, RuleToggle } from "@/components/app/alert-forms";
import { Badge, buttonClass, Card, cx, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { ALERT_LABELS, type AlertType } from "@/lib/alerts/rules";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isUuid, queryOne, withUser } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage({ searchParams }: PageProps<"/app/alerts">) {
  const user = await requirePageUser("/app/alerts");
  const sp = await searchParams;
  const tab = sp.tab === "inbox" || sp.tab === "log" ? sp.tab : "rules";
  const ent = await getEntitlements(user.id);
  const presetId = typeof sp.tokenId === "string" && isUuid(sp.tokenId) ? sp.tokenId : null;
  const preset = presetId ? await queryOne<{ id: string; chain: string; symbol: string; name: string; logo_url: string | null }>("SELECT id, chain, symbol, name, logo_url FROM token_assets WHERE id = $1", [presetId]) : null;

  const data = await withUser(user.id, async (tx) => ({
    rules: await tx.query<{ id: string; name: string; rule_type: AlertType; params: Record<string, unknown>; channels: string[]; is_active: boolean; cooldown_minutes: number; last_triggered_at: Date | null; token_id: string | null; chain: string | null }>(
      "SELECT id, name, rule_type, params, channels, is_active, cooldown_minutes, last_triggered_at, token_id, chain FROM alert_rules ORDER BY created_at DESC",
    ),
    inbox: tab === "inbox" ? await tx.query<{ id: string; title: string; body: string; link: string | null; created_at: Date; read_at: Date | null }>(
      "SELECT id, title, body, link, created_at, read_at FROM notifications WHERE channel = 'in_app' ORDER BY created_at DESC LIMIT 100",
    ) : [],
    log: tab === "log" ? await tx.query<{ id: string; title: string; channel: string; status: string; attempts: number; last_error: string | null; created_at: Date; sent_at: Date | null }>(
      "SELECT id, title, channel, status, attempts, last_error, created_at, sent_at FROM notifications ORDER BY created_at DESC LIMIT 150",
    ) : [],
    wallets: await tx.query<{ id: string; label: string }>(
      "SELECT w.id, COALESCE(t.custom_label, w.label, w.address) AS label FROM user_tracked_wallets t JOIN wallet_profiles w ON w.id = t.wallet_id",
    ),
  }));

  const tabs = [["rules", `Rules (${data.rules.length}/${ent.features.max_alert_rules})`], ["inbox", "Inbox"], ["log", "Delivery log"]] as const;
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Rules are evaluated after every ingestion cycle against fresh data only. Each event is delivered once per channel; failed email/Telegram deliveries are retried with backoff."
        actions={tab === "inbox" ? <MarkAllRead /> : undefined}
      />
      <nav className="mb-4 flex gap-1 border-b border-line" aria-label="Alert sections">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/app/alerts?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-up text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{l}</Link>
        ))}
      </nav>

      {tab === "rules" && (
        <>
          <NewAlertForm
            presetToken={preset}
            wallets={data.wallets}
            allowedChannels={ent.features.alert_channels}
            emailVerified={user.emailVerified}
            walletAlertsAllowed={ent.features.max_tracked_wallets > 0}
          />
          <Card className="mt-4">
            {data.rules.length === 0 ? (
              <EmptyState title="No alert rules" body="Create a rule to get notified about price moves, volume spikes, new signals, security changes or wallet activity." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-terminal">
                  <thead><tr><th>Active</th><th>Name</th><th>Type</th><th>Condition</th><th>Channels</th><th className="text-right">Cooldown</th><th className="text-right">Last triggered</th><th /></tr></thead>
                  <tbody>
                    {data.rules.map((r) => (
                      <tr key={r.id}>
                        <td><RuleToggle id={r.id} active={r.is_active} /></td>
                        <td className="font-medium">{r.name}</td>
                        <td><Badge>{ALERT_LABELS[r.rule_type]}</Badge></td>
                        <td className="num text-xs text-fg-muted">{Object.entries(r.params).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join(" · ") || "any"}</td>
                        <td className="text-xs text-fg-muted">{r.channels.join(", ").replace("in_app", "in-app")}</td>
                        <td className="num text-right text-fg-muted">{r.cooldown_minutes}m</td>
                        <td className="text-right text-xs text-fg-faint">{timeAgo(r.last_triggered_at)}</td>
                        <td className="text-right">{r.token_id && <Link href={`/app/token/${r.chain ?? "solana"}/${r.token_id}`} className="mr-3 text-xs text-fg-faint hover:text-fg">token</Link>}<DeleteRule id={r.id} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "inbox" && (
        <Card>
          {data.inbox.length === 0 ? <EmptyState title="Inbox is empty" body="Triggered alerts appear here." /> : (
            <ul className="divide-y divide-line">
              {data.inbox.map((n) => (
                <li key={n.id} className={cx("flex items-start gap-3 px-4 py-3", !n.read_at && "bg-info/5")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-info")} aria-label={n.read_at ? undefined : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-sm text-fg-muted">{n.body}</div>
                    <div className="mt-1 text-xs text-fg-faint">{formatDateTime(n.created_at)}</div>
                  </div>
                  {n.link && <Link href={n.link} className={buttonClass("ghost", "sm")}>Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "log" && (
        <Card>
          {data.log.length === 0 ? <EmptyState title="No deliveries yet" /> : (
            <div className="overflow-x-auto">
              <table className="table-terminal">
                <thead><tr><th>Created</th><th>Alert</th><th>Channel</th><th>Status</th><th className="text-right">Attempts</th><th>Last error</th><th className="text-right">Sent</th></tr></thead>
                <tbody>
                  {data.log.map((n) => (
                    <tr key={n.id}>
                      <td className="text-xs">{formatDateTime(n.created_at)}</td>
                      <td>{n.title}</td>
                      <td>{n.channel}</td>
                      <td><Badge tone={n.status === "sent" || n.status === "read" ? "up" : n.status === "failed" ? "down" : "warn"}>{n.status}</Badge></td>
                      <td className="num text-right">{n.attempts}</td>
                      <td className="max-w-xs truncate text-xs text-down" title={n.last_error ?? undefined}>{n.last_error ?? ""}</td>
                      <td className="text-right text-xs text-fg-faint">{timeAgo(n.sent_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
