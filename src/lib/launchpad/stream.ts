import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { refreshDevProfiles } from "./jobs";
import { resolveLaunchLabCreate } from "./launchlab";
import { parseStreamMessage, type StreamEvent } from "./pump";

const log = logger("launchpad");

/**
 * PumpPortal live feed (free: token creations and migrations only; trade events are paid and not used).
 * Covers pump.fun and LetsBonk; LetsBonk creates are resolved on-chain because the feed mislabels them.
 * PumpPortal asks for a single connection per client, so this is a process-wide singleton that survives
 * dev hot reloads. It runs wherever the job worker runs (in-process worker or `npm run worker`), not on
 * serverless cron. Events are buffered and written in small batches.
 */
const URL = "wss://pumpportal.fun/api/data";
const FLUSH_MS = 3_000;
const SILENCE_MS = 120_000;

interface State {
  ws: WebSocket | null;
  buffer: StreamEvent[];
  lastMessageAt: number;
  retry: number;
  timers: NodeJS.Timeout[];
}

const g = globalThis as unknown as { __nxLaunchpad?: State };

export function startLaunchpadStream() {
  if (g.__nxLaunchpad || env.demoMode || typeof WebSocket === "undefined") return;
  const s: State = { ws: null, buffer: [], lastMessageAt: Date.now(), retry: 0, timers: [] };
  g.__nxLaunchpad = s;
  connect(s);
  s.timers.push(setInterval(() => void flush(s), FLUSH_MS));
  // Reconnect if the socket goes quiet (pump.fun launches several tokens a minute).
  s.timers.push(setInterval(() => {
    if (Date.now() - s.lastMessageAt > SILENCE_MS) {
      log.warn("PumpPortal feed silent, reconnecting");
      s.lastMessageAt = Date.now();
      s.ws?.close();
    }
  }, 30_000));
  log.info("Launchpad stream started");
}

/** For feed-health monitoring (src/lib/jobs/feed-health.ts). */
export function launchpadStreamStatus() {
  const s = g.__nxLaunchpad;
  return { running: Boolean(s), lastMessageAt: s?.lastMessageAt ?? 0 };
}

function connect(s: State) {
  const ws = new WebSocket(URL);
  s.ws = ws;
  ws.onopen = () => {
    s.retry = 0;
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeMigration" }));
  };
  ws.onmessage = (e) => {
    s.lastMessageAt = Date.now();
    let msg: unknown;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    const ev = parseStreamMessage(msg);
    if (ev && s.buffer.length < 5_000) s.buffer.push(ev);
  };
  ws.onerror = () => {}; // onclose follows and handles the retry
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = null;
    const delay = Math.min(60_000, 2_000 * 2 ** s.retry++);
    s.timers.push(setTimeout(() => connect(s), delay));
  };
}

async function flush(s: State) {
  if (s.buffer.length === 0) return;
  const batch = s.buffer.splice(0, s.buffer.length);
  const creators = new Set<string>();
  // Each event is applied on its own so one bad event (or a transient DB error) cannot drop the rest of the batch.
  let failed = 0;
  let lastError = "";
  for (const ev of batch) {
    try {
      await applyEvent(ev, creators);
    } catch (err) {
      failed++;
      lastError = errorMessage(err);
    }
  }
  if (failed) log.warn("Launchpad events failed", { failed, events: batch.length, error: lastError });
  try {
    await refreshDevProfiles([...creators]);
  } catch (err) {
    log.warn("Dev profile refresh failed", { creators: creators.size, error: errorMessage(err) });
  }
}

/** Writes one stream event and records the creators whose dev profile needs refreshing. */
async function applyEvent(ev: StreamEvent, creators: Set<string>) {
  if (ev.kind === "create") {
    await query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, name, symbol, uri, bonding_curve, created_at, source, initial_buy_sol,
                                    market_cap_sol, peak_market_cap_sol, initial_market_cap_sol, progress, dev_score_at_launch, dev_launches_at_launch)
       SELECT $1, $2, $3, $4, $5, $6, $7, now(), 'stream', $8, $9, $9, $9, 0, d.score, d.launches
         FROM (SELECT 1) one LEFT JOIN dev_profiles d ON d.creator = $3
       ON CONFLICT (mint) DO NOTHING`,
      [ev.mint, ev.pool, ev.creator, ev.name, ev.symbol, ev.uri, ev.bondingCurve, ev.initialBuySol, ev.marketCapSol],
    );
    creators.add(ev.creator);
  } else if (ev.kind === "launchlab_create") {
    const l = await resolveLaunchLabCreate(ev.signature).catch((err) => {
      log.warn("LetsBonk launch could not be resolved", { signature: ev.signature, error: errorMessage(err) });
      return null;
    });
    if (!l) return;
    await query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, name, symbol, uri, bonding_curve, created_at, source, progress, dev_score_at_launch, dev_launches_at_launch)
       SELECT $1, 'bonk', $2, $3, $4, $5, $6, COALESCE(to_timestamp($7), now()), 'stream', 0, d.score, d.launches
         FROM (SELECT 1) one LEFT JOIN dev_profiles d ON d.creator = $2
       ON CONFLICT (mint) DO NOTHING`,
      [l.mint, l.creator, l.name, l.symbol, l.uri, l.poolAccount, l.createdAt],
    );
    creators.add(l.creator);
  } else {
    const rows = await query<{ creator: string }>(
      `UPDATE launchpad_tokens SET migrated_at = COALESCE(migrated_at, now()), complete = true, progress = 1, updated_at = now()
        WHERE mint = $1 RETURNING creator`,
      [ev.mint],
    );
    rows.forEach((r) => creators.add(r.creator));
  }
}
