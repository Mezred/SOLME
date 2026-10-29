import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: { default: "Terminal", template: "%s · SOLME" }, robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requirePageUser();
  const [ent, unread] = await Promise.all([
    getEntitlements(user.id),
    queryOne<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL", [user.id]),
  ]);
  return (
    <AppShell
      user={{ email: user.email, displayName: user.displayName, role: user.role, emailVerified: user.emailVerified, plan: ent.planName }}
      unread={unread?.n ?? 0}
      demoMode={env.demoMode}
    >
      {children}
    </AppShell>
  );
}
