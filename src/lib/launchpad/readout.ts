import type { LaunchRow } from "@/lib/data/launchpad";

/** pending: the background scam check is still running; unchecked: it ran but could not judge (e.g. no market yet). */
export type LaunchStatus = "clear" | "caution" | "avoid" | "pending" | "unchecked";

export interface LaunchProblem {
  level: "avoid" | "caution";
  text: string;
}

export interface LaunchReadout {
  status: LaunchStatus;
  /** What is wrong, worst first. Empty for a clean launch. */
  problems: LaunchProblem[];
  /** Short neutral facts for one line: the dev's record, the check, bundle, snipers, the dev's buy. */
  facts: { text: string; good?: boolean }[];
  /** Bonding curve progress, 0–100, or null when migrated / not read yet. */
  curvePct: number | null;
  migrated: boolean;
  /** Minutes since launch. */
  ageMinutes: number;
}

/** Thresholds, % of supply: caution from the first value, avoid from the second. */
const BUNDLE = [10, 20] as const;
const SNIPERS = [15, 30] as const;
const DEV_SOLD = [1, 5] as const;
/** A fall this large from the observed peak is worth saying. */
const OFF_PEAK = 50;
/** The background scam check runs within minutes of a launch: past this, a missing result will not come. */
const CHECK_WINDOW_MINUTES = 15;
/** The launch check's wording for "could not verify": the coin is treated as unsafe, not as proven bad. */
const UNVERIFIED = /^not verified/i;

type Facts = Pick<LaunchRow,
  "check_passed" | "check_reason" | "checked_at" | "bundle_pct" | "sniper_wallets" | "sniper_pct" | "dev_sold_pct" |
  "dev_launches" | "dev_migrated" | "dev_score" | "initial_buy_sol" | "progress" | "complete" | "migrated_at" |
  "market_cap_usd" | "peak_market_cap_usd" | "created_at">;

const num = (v: number | string | null) => (v === null ? null : Number(v));
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

/**
 * Pure: one proven-dev launch in plain words.
 *  - Avoid: the scam check failed (or could not verify the coin, which it treats as unsafe), the dev sold 5%+, a
 *    bundle holds 20%+ or snipers 30%+.
 *  - Caution: a smaller dev sale, bundle (10%+) or sniper share (15%+), or 50%+ down from its peak.
 *  - Looks clear: the scam check passed and none of the above.
 *  - Checking / Not checked: the check has not finished, or ran without a verdict.
 * Problems come first, worst first; neutral facts go on one line. Describes the launch now, not where it goes.
 */
export function launchReadout(t: Facts, now = Date.now()): LaunchReadout {
  const problems: LaunchProblem[] = [];
  const add = (v: number | null, [warn, bad]: readonly [number, number], text: (v: number) => string) => {
    if (v !== null && v >= warn) problems.push({ level: v >= bad ? "avoid" : "caution", text: text(v) });
  };

  if (t.check_passed === false) {
    const reason = t.check_reason?.replace(/\.$/, "") ?? "a safety check failed";
    problems.push({ level: "avoid", text: UNVERIFIED.test(reason) ? "Scam check couldn't verify it yet: treat as unsafe" : `Scam check failed: ${reason}` });
  }
  const sold = num(t.dev_sold_pct);
  add(sold !== null && sold > 0 ? Math.max(sold, DEV_SOLD[0]) : null, DEV_SOLD, () => `Dev sold ${pct(sold!)} of supply`);
  const bundle = num(t.bundle_pct);
  add(bundle, BUNDLE, (v) => `Bundle: ${pct(v)} bought by other wallets in the launch block`);
  const snipers = num(t.sniper_pct);
  add(snipers, SNIPERS, (v) => `Snipers: ${t.sniper_wallets ?? 0} wallets hold ${pct(v)}`);
  const mcap = num(t.market_cap_usd);
  const peak = num(t.peak_market_cap_usd);
  const offPeak = mcap !== null && peak && peak > 0 && mcap < peak ? Math.round((1 - mcap / peak) * 100) : null;
  if (offPeak !== null && offPeak >= OFF_PEAK) problems.push({ level: "caution", text: `Down ${offPeak}% from its peak` });
  problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "avoid" ? -1 : 1));

  const ageMinutes = Math.max(0, (now - new Date(t.created_at).getTime()) / 60_000);
  const running = t.check_passed === null && !t.checked_at && ageMinutes < CHECK_WINDOW_MINUTES;
  // Neutral facts, the dev's record first (it is why the coin is listed).
  const facts: LaunchReadout["facts"] = [
    { text: `Dev record ${t.dev_migrated ?? 0}/${t.dev_launches ?? 0} migrated${t.dev_score !== null ? ` · score ${t.dev_score}` : ""}` },
  ];
  if (t.check_passed === true) facts.push({ text: "✓ scam check passed", good: true });
  else if (t.check_passed === null) {
    facts.push({ text: running ? "scam check running…" : t.checked_at ? `scam check couldn't run${t.check_reason ? ` (${t.check_reason.replace(/\.$/, "").toLowerCase()})` : ""}` : "no scam check result" });
  }
  if (bundle !== null && bundle < BUNDLE[0]) facts.push({ text: `bundle ${pct(bundle)}` });
  if (snipers !== null && snipers < SNIPERS[0]) facts.push({ text: `snipers ${t.sniper_wallets ?? 0} (${pct(snipers)})` });
  const devBuy = num(t.initial_buy_sol);
  if (devBuy !== null && devBuy > 0) facts.push({ text: `dev bought ${devBuy < 10 ? devBuy.toFixed(2) : Math.round(devBuy)} SOL` });

  const status: LaunchStatus = problems.some((p) => p.level === "avoid") ? "avoid"
    : problems.length ? "caution"
    : t.check_passed === true ? "clear"
    : running ? "pending"
    : "unchecked";
  const migrated = Boolean(t.complete || t.migrated_at);
  const progress = num(t.progress);
  return {
    status,
    problems,
    facts,
    curvePct: !migrated && progress !== null ? Math.round(Math.min(1, progress) * 100) : null,
    migrated,
    ageMinutes,
  };
}
