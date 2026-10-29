import { deliverNotifications, evaluateAlerts } from "@/lib/alerts/engine";
import { pollTelegramUpdates } from "@/lib/alerts/telegram";
import { queryOne } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { pruneOldData, runIngestionCycle } from "@/lib/ingestion/pipeline";
import { errorMessage, logger } from "@/lib/log";
import { flushProviderHealth } from "@/lib/providers/health";
import { getSetting } from "@/lib/settings";
import { backfillDevs, linkDevFunders, pruneLaunchpad, refreshCurves, refreshLaunchMarkets, rescoreOldDevs } from "@/lib/launchpad/jobs";
import { FAST_RULES } from "@/lib/alerts/rules";
import { discoverEarlyBuyers, scoreDueWallets, watchSmartWallets } from "@/lib/wallets/smart-money";
import { syncWallets } from "@/lib/wallets/sync";
import { computeCopyStats } from "@/lib/wallets/copy";
import { processCryptoPayments } from "@/lib/billing/crypto";
import { sampleEarlyBuyers } from "@/lib/early/buyers";
import { recheckWatchedCoins } from "@/lib/alerts/watch-checks";
import { checkFeeds } from "./feed-health";
import { ensureDemoData } from "@/lib/demo/seed";
import { checkFreshLaunches, checkNewLaunches, fillLaunchFacts } from "@/lib/launchpad/checks";
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
  // Scam-check verdicts for fresh launches shown on Proven Devs / Trenches (small, credit-bounded batches).
  "launchpad.checks": async () => {
    if (!env.demoMode) await checkFreshLaunches();
  },
  // First check of a proven-dev launch within seconds; sent alerts are edited with the result.
  "launchpad.checks.fast": async () => {
    if (!env.demoMode) {
      await checkNewLaunches();
      await fillLaunchFacts();
    }
  },
  "alerts.evaluate": async () => {
    await evaluateAlerts();
  },
  "alerts.deliver": async () => {
    await deliverNotifications();
  },
  // Bot messages: links chats that pressed Start on a Connect Telegram link.
  "telegram.poll": async () => {
    if (integrations.telegram) await pollTelegramUpdates();
  },
  // Crypto subscriptions: confirm open Solana Pay quotes on-chain, send renewal reminders.
  "billing.crypto": async () => {
    if (!env.demoMode) await processCryptoPayments();
  },
  "wallets.sync": async () => {
    await syncWallets();
  },
  // Unique buyers for the top Early Coins, from real pool trades (credit-bounded).
  "early.buyers": async () => {
    if (!env.demoMode) await sampleEarlyBuyers();
  },
  // The full Coin Check on watched coins, for the watchlist risk alert (credit-bounded).
  "watchlist.recheck": async () => {
    if (!env.demoMode) await recheckWatchedCoins();
  },
  "smartmoney.discover": async () => {
    if (!env.demoMode) await discoverEarlyBuyers();
  },
  "wallets.score": async () => {
    if (!env.demoMode) await scoreDueWallets();
  },
  // Launchpad and smart-wallet alerts are time-critical: evaluate and push them on every tick.
  "alerts.fast": async () => {
    if ((await evaluateAlerts(FAST_RULES)) > 0) await deliverNotifications();
  },
  "smartmoney.copystats": async () => {
    if (!env.demoMode) await computeCopyStats();
  },
  "smartmoney.watch": async () => {
    if (!env.demoMode) await watchSmartWallets();
  },
  "launchpad.curves": async () => {
    if (!env.demoMode) await refreshCurves();
  },
  "launchpad.markets": async () => {
    if (!env.demoMode) await refreshLaunchMarkets();
  },
  "launchpad.backfill": async () => {
    if (env.demoMode) return;
    await backfillDevs();
    // Dev score v2: link creators by funder, and move older scores to the current version.
    await linkDevFunders();
    await rescoreOldDevs();
  },
  // Live feeds (launches, smart wallets): status for /api/health and Telegram alerts to admins on gaps.
  "health.feeds": async () => {
    await checkFeeds();
  },
  "maintenance.prune": async () => {
    await pruneOldData();
    await pruneLaunchpad();
  },
};

/** Recurring schedule. Slot-based dedup keys make scheduling idempotent across instances. */
async function scheduleRecurring() {
  const ingestion = await getSetting("ingestion");
  const now = Date.now();
  const every: [string, number][] = [
    ["ingest.cycle", Math.max(30, ingestion.interval_seconds)],
    ["alerts.deliver", 30],
    ["launchpad.checks", 180],
    ["launchpad.checks.fast", 15],
    ["telegram.poll", 15],
    ["billing.crypto", 15],
    ["early.buyers", 300],
    ["watchlist.recheck", 600],
    ["wallets.sync", 600],
    // Helius credit budget: see src/lib/wallets/smart-money.ts before shortening these.
    ["smartmoney.discover", 1800],
    ["wallets.score", 900],
    ["launchpad.curves", 30],
    ["alerts.fast", 15],
    ["smartmoney.watch", 90],
    ["smartmoney.copystats", 1800],
    ["launchpad.markets", 600],
    ["launchpad.backfill", 600],
    ["health.feeds", 60],
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
