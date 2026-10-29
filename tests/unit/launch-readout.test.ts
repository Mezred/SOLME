import { describe, expect, it } from "vitest";
import { launchReadout } from "@/lib/launchpad/readout";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const base = {
  check_passed: true as boolean | null,
  check_reason: null as string | null,
  checked_at: new Date(NOW - 60_000),
  bundle_pct: 3 as number | null,
  sniper_wallets: 2 as number | null,
  sniper_pct: 4 as number | null,
  dev_sold_pct: null as number | null,
  dev_launches: 6 as number | null,
  dev_migrated: 4 as number | null,
  dev_score: 72 as number | null,
  initial_buy_sol: 1.5 as number | null,
  progress: 0.63 as number | null,
  complete: false,
  migrated_at: null as Date | null,
  market_cap_usd: 12_000 as number | null,
  peak_market_cap_usd: 14_000 as number | null,
  created_at: new Date(NOW - 4 * 60_000),
};

describe("proven-dev launch readout", () => {
  it("looks clear when the scam check passed and nothing stands out, with the facts on one line", () => {
    const r = launchReadout(base, NOW);
    expect(r.status).toBe("clear");
    expect(r.problems).toEqual([]);
    expect(r.facts.map((f) => f.text)).toEqual(["Dev record 4/6 migrated · score 72", "✓ scam check passed", "bundle 3.0%", "snipers 2 (4.0%)", "dev bought 1.50 SOL"]);
    expect(r.curvePct).toBe(63);
    expect(r.ageMinutes).toBe(4);
  });

  it("says Avoid for a failed check, a big dev sale, bundle or snipers, worst problems first", () => {
    expect(launchReadout({ ...base, check_passed: false, check_reason: "Mint authority enabled." }, NOW).problems[0].text).toBe("Scam check failed: Mint authority enabled");
    expect(launchReadout({ ...base, dev_sold_pct: 6 }, NOW).status).toBe("avoid");
    expect(launchReadout({ ...base, bundle_pct: 25 }, NOW).status).toBe("avoid");
    const r = launchReadout({ ...base, sniper_wallets: 9, sniper_pct: 34, market_cap_usd: 2_000, peak_market_cap_usd: 20_000 }, NOW);
    expect(r.status).toBe("avoid");
    expect(r.problems).toEqual([
      { level: "avoid", text: "Snipers: 9 wallets hold 34%" },
      { level: "caution", text: "Down 90% from its peak" },
    ]);
  });

  it("words an unverified coin as unverified, not as a failed check, but still avoids it", () => {
    const r = launchReadout({ ...base, check_passed: false, check_reason: "Not verified yet — treat as unsafe until checked" }, NOW);
    expect(r.status).toBe("avoid");
    expect(r.problems[0].text).toBe("Scam check couldn't verify it yet: treat as unsafe");
  });

  it("says Caution for smaller versions of the same, including any dev sale", () => {
    expect(launchReadout({ ...base, dev_sold_pct: 0.4 }, NOW).problems).toEqual([{ level: "caution", text: "Dev sold 0.4% of supply" }]);
    expect(launchReadout({ ...base, bundle_pct: 12 }, NOW).status).toBe("caution");
  });

  it("separates a check still running from one that ran without a verdict", () => {
    expect(launchReadout({ ...base, check_passed: null, checked_at: null }, NOW).status).toBe("pending");
    const r = launchReadout({ ...base, check_passed: null, check_reason: "No market yet." }, NOW);
    expect(r.status).toBe("unchecked");
    expect(r.facts[1].text).toBe("scam check couldn't run (no market yet)");
    expect(launchReadout({ ...base, check_passed: null, checked_at: null, bundle_pct: 15 }, NOW).status).toBe("caution");
    // Hours later with no result, it is no longer "running".
    const old = launchReadout({ ...base, check_passed: null, checked_at: null, created_at: new Date(NOW - 3 * 3_600_000) }, NOW);
    expect(old.status).toBe("unchecked");
    expect(old.facts[1].text).toBe("no scam check result");
  });

  it("shows Migrated instead of curve progress once the coin left the curve", () => {
    const r = launchReadout({ ...base, complete: true, progress: 1 }, NOW);
    expect(r.migrated).toBe(true);
    expect(r.curvePct).toBeNull();
  });
});
