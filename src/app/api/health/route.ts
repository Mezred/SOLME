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
    return NextResponse.json({
      status: "ok",
      db: { driver: db.driver, latencyMs: Date.now() - started },
      demoMode: env.demoMode,
      marketDataAgeSeconds: ageSec,
      integrations,
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
