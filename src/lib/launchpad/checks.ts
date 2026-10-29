import { editTelegramHtml } from "@/lib/alerts/telegram";
import { formatTelegramAlert, launchCheckToAlert, type AlertCard } from "@/lib/alerts/telegram-format";
import type { ChainId } from "@/lib/chains";
import { query } from "@/lib/db";
import { checkToken, passesScamCheck } from "@/lib/decision/check-token";
import { env } from "@/lib/env";
import { getHolderReport } from "@/lib/tokens/holders";
import { errorMessage, logger } from "@/lib/log";
import { PROVEN_DEV_SCORE } from "./pump";

const log = logger("launch-checks");

/** Each full check costs ~15 Helius credits (holders) plus a GoPlus call, so the jobs are small and coins are re-checked hourly at most. */
const PER_RUN = 3;

/**
 * Background job: runs the full scam check (contract, exit, holders, dev wallet, bundle) on the launches traders are
 * looking at: proven-dev launches from the last hour first, then curves 70%+ complete.
 */
export async function checkFreshLaunches(): Promise<number> {
  const due = await query<{ mint: string; chain: ChainId }>(
    `SELECT l.mint, l.chain FROM launchpad_tokens l
       LEFT JOIN dev_profiles d ON d.creator = l.creator
       LEFT JOIN launch_checks c ON c.mint = l.mint
      WHERE l.source = 'stream' AND l.migrated_at IS NULL AND NOT l.complete
        AND (c.mint IS NULL OR c.checked_at < now() - interval '1 hour')
        AND ((d.score >= $1 AND COALESCE(d.launches, 0) >= 2 AND l.created_at > now() - interval '1 hour')
             OR (l.progress >= 0.7 AND l.created_at > now() - interval '6 hours'))
      ORDER BY (d.score >= $1 AND l.created_at > now() - interval '1 hour') DESC NULLS LAST, l.progress DESC NULLS LAST
      LIMIT ${PER_RUN}`,
    [PROVEN_DEV_SCORE],
  );
  for (const l of due) await checkLaunch(l.mint, l.chain);
  return due.length;
}

/**
 * Fast path (every ~15s): launches less than an hour old by a proven dev, or that already went out in an alert, get
 * their first check right away. Until the coin has a DEX market the check is retried every 30s for 20 minutes.
 */
export async function checkNewLaunches(): Promise<number> {
  const due = await query<{ mint: string; chain: ChainId }>(
    `SELECT l.mint, l.chain FROM launchpad_tokens l
       LEFT JOIN dev_profiles d ON d.creator = l.creator
       LEFT JOIN launch_checks c ON c.mint = l.mint
      WHERE l.source = 'stream' AND l.created_at > now() - interval '1 hour'
        AND (c.mint IS NULL
             OR (c.passed IS NULL AND c.checked_at < now() - interval '30 seconds' AND l.created_at > now() - interval '20 minutes'))
        AND ((COALESCE(l.dev_score_at_launch, d.score) >= $1 AND COALESCE(l.dev_launches_at_launch, d.launches, 0) >= 2)
             OR EXISTS (SELECT 1 FROM notifications n WHERE n.meta->>'address' = l.mint AND n.meta ? 'check' AND n.created_at > now() - interval '1 hour'))
      ORDER BY c.mint IS NULL DESC, l.created_at DESC
      LIMIT ${PER_RUN}`,
    [PROVEN_DEV_SCORE],
  );
  for (const l of due) await checkLaunch(l.mint, l.chain);
  return due.length;
}

async function checkLaunch(mint: string, chain: ChainId) {
  let passed: boolean | null = null;
  let verdict: string | null = null;
  let reason: string | null = null;
  try {
    const c = await checkToken(chain, mint, { explicit: true });
    if (c) {
      passed = passesScamCheck(c.decision);
      verdict = c.decision.verdict;
      // Order flow is market activity, not a safety finding: leave it out of the reason shown with the scam check.
      const safety = c.decision.gate.filter((g) => g.key !== "flow");
      reason = passed
        ? safety.find((g) => g.status === "warn")?.detail ?? "No safety check failed"
        : (safety.find((g) => g.status === "fail" || g.status === "unknown") ?? c.decision.gate.find((g) => g.status === "fail"))?.detail ?? c.decision.headline;
    } else {
      reason = "No DEX market yet";
    }
  } catch (err) {
    reason = "Check failed, will retry";
    log.warn("Launch check failed", { mint, error: errorMessage(err) });
  }
  reason = reason?.slice(0, 200) ?? null;
  await query(
    `INSERT INTO launch_checks (mint, chain, passed, verdict, reason, checked_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (mint) DO UPDATE SET passed = EXCLUDED.passed, verdict = EXCLUDED.verdict, reason = EXCLUDED.reason, checked_at = now()`,
    [mint, chain, passed, verdict, reason],
  );
  await updateSentAlerts(mint, { check: { passed, reason } });
}

/** Launch facts are read once the sniper window (10s after launch) has closed and the transactions are queryable. */
const FACTS_AFTER_SECONDS = 20;

/**
 * Bundle and sniper share of a fresh Solana launch that is being checked (proven dev or alerted), captured once from
 * the holder report's launch analysis (shared ~15-credit report, cached 5 minutes) and added to alerts already sent.
 */
export async function fillLaunchFacts(): Promise<number> {
  const due = await query<{ mint: string }>(
    `SELECT l.mint FROM launchpad_tokens l JOIN launch_checks c ON c.mint = l.mint
      WHERE l.chain = 'solana' AND c.launch_facts_at IS NULL
        AND l.created_at < now() - make_interval(secs => $1) AND l.created_at > now() - interval '1 hour'
      ORDER BY l.created_at DESC LIMIT ${PER_RUN}`,
    [FACTS_AFTER_SECONDS],
  );
  for (const { mint } of due) {
    let launch: NonNullable<Awaited<ReturnType<typeof getHolderReport>>>["launch"] = null;
    try {
      launch = (await getHolderReport("solana", mint))?.launch ?? null;
    } catch (err) {
      log.warn("Launch facts failed", { mint, error: errorMessage(err) });
    }
    await query("UPDATE launch_checks SET bundle_pct = $2, sniper_wallets = $3, sniper_pct = $4, launch_facts_at = now() WHERE mint = $1", [
      mint,
      launch?.bundlePct ?? null,
      launch?.sniperWallets ?? null,
      launch?.sniperPct ?? null,
    ]);
    if (launch) await updateSentAlerts(mint, { facts: launchFacts(launch) });
  }
  return due.length;
}

export function launchFacts(l: { bundlePct: number; bundleWallets: number; sniperWallets: number; sniperPct: number }): [string, string][] {
  return [
    ["Launch bundle", `${l.bundlePct.toFixed(1)}% of supply · ${l.bundleWallets} wallet${l.bundleWallets === 1 ? "" : "s"}`],
    ["Snipers (first 10s)", `${l.sniperWallets} wallet${l.sniperWallets === 1 ? "" : "s"} · ${l.sniperPct.toFixed(1)}%`],
  ];
}

/** Facts by label: new values replace old ones, new labels are appended. */
function mergeFacts(old: [string, string][], add: [string, string][]): [string, string][] {
  const out = old.map(([k, v]) => [k, add.find(([a]) => a === k)?.[1] ?? v] as [string, string]);
  for (const f of add) if (!old.some(([k]) => k === f[0])) out.push(f);
  return out;
}

/** Edits Telegram alerts already sent for this coin with a new check result and/or facts (only when something changed). */
export async function updateSentAlerts(mint: string, patch: { check?: { passed: boolean | null; reason: string | null }; facts?: [string, string][] }): Promise<number> {
  const check = patch.check ? launchCheckToAlert(patch.check) : null;
  const sent = await query<{ id: string; tg_chat_id: string; tg_message_id: number; link: string | null; meta: AlertCard }>(
    `SELECT id, tg_chat_id, tg_message_id, link, meta FROM notifications
      WHERE tg_message_id IS NOT NULL AND meta->>'address' = $1 AND meta ? 'check' AND created_at > now() - interval '2 days'`,
    [mint],
  );
  let edited = 0;
  for (const n of sent) {
    // jsonb reorders keys, so compare fields rather than serialized objects.
    const sameCheck = !check || (n.meta.check?.status === check.status && (n.meta.check.reason ?? null) === (check.reason ?? null));
    const facts = patch.facts ? mergeFacts(n.meta.facts, patch.facts) : n.meta.facts;
    if (sameCheck && JSON.stringify(facts) === JSON.stringify(n.meta.facts)) continue;
    const meta = { ...n.meta, facts, ...(check ? { check } : {}) };
    const m = formatTelegramAlert(meta, n.link ? `${env.appUrl}${n.link}` : env.appUrl);
    try {
      await editTelegramHtml(n.tg_chat_id, Number(n.tg_message_id), m.text, m.buttons);
      await query("UPDATE notifications SET meta = $2 WHERE id = $1", [n.id, JSON.stringify(meta)]);
      edited++;
    } catch (err) {
      log.warn("Could not update Telegram alert", { mint, error: errorMessage(err) });
    }
  }
  return edited;
}
