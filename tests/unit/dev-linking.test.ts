import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { refreshDevProfiles, rescoreOldDevs } from "@/lib/launchpad/jobs";
import { DEV_SCORE_VERSION } from "@/lib/launchpad/pump";

let db: Database;
let n = 0;

/** A launch by `creator`, `days` old; migrated ones held (or not) an hour after migration. */
async function launch(creator: string, days: number, outcome: "failed" | "held" | "dumped") {
  const migrated = outcome !== "failed";
  await db.query(
    `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, complete, migrated_at, mcap_at_migration_usd, held_mcap_usd)
     VALUES ($1, 'pump', $2, now() - make_interval(days => $3), 'stream', $4, CASE WHEN $4 THEN now() - make_interval(days => $3) END, $5, $6)`,
    [`Mint${n++}`, creator, days, migrated, migrated ? 60_000 : null, outcome === "held" ? 400_000 : outcome === "dumped" ? 5_000 : null],
  );
}

const profile = async (creator: string) =>
  (await db.query<{ score: number; launches: number; own_launches: number; linked_wallets: number; confidence: string; score_version: number }>(
    "SELECT score, launches, own_launches, linked_wallets, confidence, score_version FROM dev_profiles WHERE creator = $1",
    [creator],
  ))[0];

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
});

afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

describe("dev score v2 with funder-linked wallets", () => {
  it("scores a dev whose migrations held as proven", async () => {
    for (const o of ["held", "held", "failed"] as const) await launch("GoodDev", 3, o);
    await refreshDevProfiles(["GoodDev"]);
    expect((await profile("GoodDev")).score).toBeGreaterThanOrEqual(60);
  });

  it("does not let a dumper reset their record with a fresh wallet", async () => {
    for (const o of ["dumped", "dumped", "failed", "failed"] as const) await launch("Dumper", 3, o);
    await launch("FreshWallet", 0, "failed");
    await db.query("INSERT INTO dev_profiles (creator, funder) VALUES ('Dumper', 'Funder1'), ('FreshWallet', 'Funder1')");
    await refreshDevProfiles(["FreshWallet"]);
    const fresh = await profile("FreshWallet");
    expect(fresh).toMatchObject({ launches: 5, own_launches: 1, linked_wallets: 2 });
    expect(fresh.score).toBeLessThanOrEqual(40);
    expect((await profile("Dumper")).score).toBe(fresh.score);
  });

  it("ignores exchange-like funders shared by many creators", async () => {
    const creators = Array.from({ length: 20 }, (_, i) => `Retail${i}`);
    await launch("Retail0", 3, "held");
    await launch("Retail0", 3, "held");
    for (const c of creators) await db.query("INSERT INTO dev_profiles (creator, funder) VALUES ($1, 'ExchangeHotWallet') ON CONFLICT (creator) DO UPDATE SET funder = EXCLUDED.funder", [c]);
    await refreshDevProfiles(["Retail0"]);
    expect(await profile("Retail0")).toMatchObject({ launches: 2, linked_wallets: 1 });
  });

  it("moves old scores to the current version", async () => {
    await launch("OldDev", 3, "failed");
    await db.query("INSERT INTO dev_profiles (creator, launches, migrated, score, score_version) VALUES ('OldDev', 1, 0, 33, 1)");
    expect(await rescoreOldDevs()).toBeGreaterThan(0);
    expect(await profile("OldDev")).toMatchObject({ score_version: DEV_SCORE_VERSION, confidence: "low" });
    expect(await rescoreOldDevs()).toBe(0);
  });
});
