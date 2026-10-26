/**
 * Runs once per server instance. Starts the background job loop in-process when WORKER_IN_PROCESS is
 * enabled (default with embedded PGlite). Production deployments with Postgres run `npm run worker`
 * or call /api/cron/tick on a schedule instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { env } = await import("@/lib/env");
  if (!env.workerInProcess) return;
  const { getDb } = await import("@/lib/db");
  await getDb();
  const { startInProcessWorker } = await import("@/lib/jobs/scheduler");
  startInProcessWorker();
}

export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger, errorMessage } = await import("@/lib/log");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  logger("next").error("Request error", { path: request.path, method: request.method, error: errorMessage(err), digest });
}
