import { NextResponse } from "next/server";
import { getDb, queryOne } from "@/lib/db";
import { env, integrations } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + readiness. Public, and reveals no secrets: only which integrations are configured. */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    const latest = await queryOne<{ at: Date | null }>("SELECT max(captured_at) AS at FROM market_snapshots");
    const ageSec = latest?.at ? Math.round((Date.now() - new Date(latest.at).getTime()) / 1000) : null;
    // Written every minute by the worker (which may be another process): live feeds and when they were last checked.
    const feeds = await queryOne<{ value: { states?: { feed: string; ok: boolean }[]; checkedAt?: string } }>("SELECT value FROM app_settings WHERE key = 'feed_health'");
    return NextResponse.json({
      status: "ok",
      db: { driver: db.driver, latencyMs: Date.now() - started },
      demoMode: env.demoMode,
      marketDataAgeSeconds: ageSec,
      feeds: { checkedAt: feeds?.value.checkedAt ?? null, status: Object.fromEntries((feeds?.value.states ?? []).map((s) => [s.feed, s.ok ? "ok" : "down"])) },
      integrations,
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
