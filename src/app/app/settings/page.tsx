import type { Metadata } from "next";
import { DeleteAccount, PasswordForm, ProfileForm, SessionActions } from "@/components/app/settings-forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query, queryOne } from "@/lib/db";
import { integrations } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Account Settings" };

export default async function SettingsPage() {
  const user = await requirePageUser("/app/settings");
  const [ent, profile, sessions] = await Promise.all([
    getEntitlements(user.id),
    queryOne<{ display_name: string | null; timezone: string; notify_in_app: boolean; notify_email: boolean; notify_telegram: boolean; telegram_chat_id: string | null }>(
      "SELECT display_name, timezone, notify_in_app, notify_email, notify_telegram, telegram_chat_id FROM profiles WHERE user_id = $1",
      [user.id],
    ),
    query<{ id: string; ip: string | null; user_agent: string | null; created_at: Date; last_seen_at: Date }>(
      "SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC",
      [user.id],
    ),
  ]);

  return (
    <>
      <PageHeader title="Account Settings" description="Profile, alert delivery, security and privacy." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile & notifications" subtitle={<>{user.email} {user.emailVerified ? <Badge tone="up">verified</Badge> : <Badge tone="warn">unverified</Badge>}</>} />
          <div className="p-4">
            <ProfileForm
              initial={{
                displayName: profile?.display_name ?? null,
                timezone: profile?.timezone ?? "UTC",
                notifyInApp: profile?.notify_in_app ?? true,
                notifyEmail: profile?.notify_email ?? true,
                notifyTelegram: profile?.notify_telegram ?? false,
                telegramChatId: profile?.telegram_chat_id ?? null,
              }}
              telegramConfigured={integrations.telegram}
              emailConfigured={integrations.email}
              channels={ent.features.alert_channels}
            />
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Password" />
            <div className="p-4"><PasswordForm /></div>
          </Card>
          <Card>
            <CardHeader title="Active sessions" action={sessions.length > 1 ? <SessionActions /> : undefined} />
            <ul className="divide-y divide-line">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-fg-muted">{s.user_agent ?? "Unknown device"}</div>
                    <div className="text-xs text-fg-faint">{s.ip ?? "unknown IP"} · signed in {formatDateTime(s.created_at)} · active {timeAgo(s.last_seen_at)}</div>
                  </div>
                  <SessionActions id={s.id} current={s.id === user.sessionId} />
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Privacy & data" />
            <div className="space-y-3 p-4 text-sm text-fg-muted">
              <p>We store your email, hashed password, preferences, and the watchlists, positions, alerts and AI conversations you create. We never store wallet private keys or card details.</p>
              <DeleteAccount />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
