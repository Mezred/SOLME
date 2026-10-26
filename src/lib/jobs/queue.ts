import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { backoff } from "@/lib/providers/http";
import { errorMessage, logger } from "@/lib/log";

const log = logger("jobs");

export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (job: Job) => Promise<void>;

/** Enqueues a job. With a dedupKey, duplicate enqueues (e.g. from several instances) are no-ops. */
export async function enqueue(
  type: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupKey?: string; maxAttempts?: number } = {},
): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO jobs (type, payload, run_at, dedup_key, max_attempts)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5)
     ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
    [type, JSON.stringify(payload), opts.runAt ?? null, opts.dedupKey ?? null, opts.maxAttempts ?? 5],
  );
  return row?.id ?? null;
}

/** Atomically claims the next due job. SKIP LOCKED lets several workers share one queue. */
export async function claimJob(workerId: string): Promise<Job | null> {
  return queryOne<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
        ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts, max_attempts`,
    [workerId],
  );
}

export async function completeJob(id: number) {
  await query("UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL WHERE id = $1", [id]);
}

export async function failJob(job: Job, err: unknown) {
  const final = job.attempts >= job.max_attempts;
  const delayMs = backoff(job.attempts) * 4;
  await query(
    `UPDATE jobs SET status = $2, last_error = $3, locked_at = NULL,
       run_at = CASE WHEN $2 = 'queued' THEN now() + make_interval(secs => $4) ELSE run_at END,
       finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
     WHERE id = $1`,
    [job.id, final ? "failed" : "queued", errorMessage(err).slice(0, 1000), delayMs / 1000],
  );
  log[final ? "error" : "warn"]("Job failed", { id: job.id, type: job.type, attempts: job.attempts, final, error: errorMessage(err) });
}

/** Requeues jobs whose worker died mid-run. */
export async function recoverStuckJobs(minutes = 10) {
  await query(
    `UPDATE jobs SET status = 'queued', locked_at = NULL
      WHERE status = 'running' AND locked_at < now() - make_interval(mins => $1)`,
    [minutes],
  );
}

export async function processJobs(handlers: Record<string, JobHandler>, opts: { max?: number; workerId?: string } = {}) {
  const workerId = opts.workerId ?? `w-${randomUUID().slice(0, 8)}`;
  let processed = 0;
  while (processed < (opts.max ?? 20)) {
    const job = await claimJob(workerId);
    if (!job) break;
    processed++;
    const handler = handlers[job.type];
    if (!handler) {
      await failJob({ ...job, attempts: job.max_attempts }, new Error(`No handler for job type ${job.type}`));
      continue;
    }
    const started = Date.now();
    try {
      await handler(job);
      await completeJob(job.id);
      log.debug("Job done", { id: job.id, type: job.type, ms: Date.now() - started });
    } catch (err) {
      await failJob(job, err);
    }
  }
  return processed;
}
