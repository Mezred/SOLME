import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { HOLDOUT_DAYS, INSIDER_CAP, scoreWallet, scoreWalletV2, type EvaluatedPosition } from "@/lib/wallets/scoring";
import { insiderReason } from "@/lib/wallets/smart-money";

const NOW = 1_800_000_000;
const DAY = 86_400;
let n = 0;

/** A closed position opened `daysAgo`, won or lost `pnl` SOL on a 1 SOL entry. */
function pos(daysAgo: number, pnl: number, mint = `M${n++}`): EvaluatedPosition {
  const at = NOW - daysAgo * DAY;
  return {
    mint, buys: 1, sells: 1, bought: 1000, sold: 1000, solIn: 1, solOut: 1 + pnl, firstBuyAt: at, lastSellAt: at + 3600,
    status: "closed", heldValueSol: 0, pnlSol: pnl, multiple: 1 + pnl, entryDelaySeconds: null, early: false, hit: false,
  };
}
const older = (wins: number, losses: number) => [...Array.from({ length: wins }, () => pos(20, 1)), ...Array.from({ length: losses }, () => pos(20, -0.5))];
const score = (ps: EvaluatedPosition[], opts: { exclude?: Set<string>; insider?: string | null } = {}) => scoreWalletV2(ps, [], 30, { now: NOW, ...opts });

describe("wallet score v2", () => {
  it("leaves the coin the wallet was discovered on out of its score", () => {
    const pump = pos(20, 50, "DiscoveryPump"); // the 50x we found it on
    const base = older(3, 3);
    const withPump = score([...base, pump]);
    const without = score([...base, pump], { exclude: new Set(["DiscoveryPump"]) });
    expect(without.excluded).toBe(1);
    expect(without.score!).toBeLessThan(withPump.score!);
    expect(without.score).toBe(score(base).score);
  });

  it("scores older trades only and checks them on the last 10 days", () => {
    const train = older(5, 2);
    const trained = scoreWallet(train, [], 30).score!;
    const recentWins = Array.from({ length: 3 }, () => pos(HOLDOUT_DAYS - 2, 0.5));
    const recentLosses = Array.from({ length: 4 }, () => pos(HOLDOUT_DAYS - 2, -0.8));

    const held = score([...train, ...recentWins]);
    expect(held.oos.verdict).toBe("held_up");
    expect(held.score).toBe(trained); // recent trades checked, not scored

    const faded = score([...train, ...recentLosses]);
    expect(faded.oos).toMatchObject({ verdict: "faded", decided: 4, wins: 0 });
    expect(faded.score).toBe(Math.round(trained * 0.7));

    expect(score([...train, pos(1, -0.8)]).oos.verdict).toBe("too_few");
  });

  it("falls back to the whole window (unchecked) when there are too few older trades", () => {
    const recentOnly = Array.from({ length: 6 }, (_, i) => pos(3, i % 2 ? 1 : -0.5));
    const s = score(recentOnly);
    expect(s.oos.verdict).toBe("too_few");
    expect(s.score).toBe(scoreWallet(recentOnly, [], 30).score);
  });

  it("caps insiders below every smart-wallet list", () => {
    expect(score(older(7, 0), { insider: "funded a coin creator" }).score).toBe(INSIDER_CAP);
  });
});

describe("insider detection", () => {
  let db: Database;
  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
    await db.query("INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source) VALUES ('M1', 'pump', 'CreatorA', now(), 'stream')");
    await db.query("INSERT INTO dev_profiles (creator, funder) VALUES ('CreatorA', 'DevFunder')");
    for (let i = 0; i < 20; i++) await db.query("INSERT INTO dev_profiles (creator, funder) VALUES ($1, 'Exchange')", [`Retail${i}`]);
  });
  afterAll(async () => {
    setDbOverride(undefined);
    await db.close();
  });

  it("names why a wallet looks like an insider", async () => {
    expect(await insiderReason("CreatorA", null)).toBe("launches coins itself");
    expect(await insiderReason("DevFunder", null)).toBe("funded a coin creator");
    expect(await insiderReason("Trader1", "CreatorA")).toBe("funded by a coin creator");
    expect(await insiderReason("Trader2", "DevFunder")).toBe("same funder as a coin creator");
    expect(await insiderReason("Trader3", "Exchange")).toBeNull(); // exchange hot wallet funds everyone
    expect(await insiderReason("Trader4", null)).toBeNull();
  });
});
