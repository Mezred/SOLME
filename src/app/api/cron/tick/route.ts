import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { tick } from "@/lib/jobs/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  if (!env.cronSecret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Scheduler entry point for serverless hosts (e.g. Vercel Cron). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await tick();
  return NextResponse.json({ ok: true, ...r });
}
