import { deliverNotifications, evaluateAlerts } from "@/lib/alerts/engine";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { pruneOldData, runIngestionCycle, trackSignalOutcomes } from "@/lib/ingestion/pipeline";
import { errorMessage, logger } from "@/lib/log";
import { flushProviderHealth } from "@/lib/providers/health";
import { getSetting } from "@/lib/settings";
import { syncWallets } from "@/lib/wallets/sync";
import { ensureDemoData } from "@/lib/demo/seed";
import { enqueue, processJobs, recoverStuckJobs, type JobHandler } from "./queue";

const log = logger("scheduler");

export const handlers: Record<string, JobHandler> = {
  "ingest.cycle": async () => {
    if (env.demoMode) await ensureDemoData();
    else {
      // A slow cycle can overlap the next slot; skip if one just finished.
      const last = await queryOne<{ value: { finishedAt?: string } }>("SELECT value FROM app_settings WHERE key = 'ingestion_status'");
      const finished = last?.value.finishedAt ? Date.now() - new Date(last.value.finishedAt).getTime() : Infinity;
      if (finished < 45_000) return;
      await runIngestionCycle();
    }
    await evaluateAlerts();
  },
  "signals.track": async () => {
    await trackSignalOutcomes();
  },
  "alerts.evaluate": async () => {
    await evaluateAlerts();
  },
  "alerts.deliver": async () => {
    await deliverNotifications();
  },
  "wallets.sync": async () => {
    await syncWallets();
  },
  "maintenance.prune": async () => {
    await pruneOldData();
  },
};

/** Recurring schedule. Slot-based dedup keys make scheduling idempotent across instances. */
async function scheduleRecurring() {
  const ingestion = await getSetting("ingestion");
  const now = Date.now();
  const every: [string, number][] = [
    ["ingest.cycle", Math.max(30, ingestion.interval_seconds)],
    ["alerts.deliver", 30],
    ["signals.track", 300],
    ["wallets.sync", 600],
    ["maintenance.prune", 3600],
  ];
  for (const [type, seconds] of every) {
    const slot = Math.floor(now / (seconds * 1000));
    await enqueue(type, {}, { dedupKey: `${type}:${slot}`, maxAttempts: 2 });
  }
}

let running = false;

/** One scheduler tick: enqueue due recurring jobs, then drain the queue. Safe to call concurrently. */
export async function tick(): Promise<{ processed: number }> {
  if (running) return { processed: 0 };
  running = true;
  try {
    await recoverStuckJobs();
    await scheduleRecurring();
    const processed = await processJobs(handlers, { max: 20 });
    await flushProviderHealth();
    return { processed };
  } catch (err) {
    log.error("Scheduler tick failed", { error: errorMessage(err) });
    return { processed: 0 };
  } finally {
    running = false;
  }
}

const g = globalThis as unknown as { __nxWorker?: NodeJS.Timeout };

/** Starts the in-process worker (local development / single-instance deployments). */
export function startInProcessWorker(intervalMs = 15_000) {
  if (g.__nxWorker) return;
  log.info("Starting in-process worker", { intervalMs, demoMode: env.demoMode });
  setTimeout(() => void tick(), 3_000);
  g.__nxWorker = setInterval(() => void tick(), intervalMs);
}
