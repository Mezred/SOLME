import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanParams, listTemplates } from "@/lib/data/screener-templates";
import { SCREENER_PRESETS } from "@/lib/data/screener-presets";
import { listTokens, screenerCoverage, tokenFilterSchema } from "@/lib/data/tokens";
import { createTestDb, setDbOverride, withUser, type Database } from "@/lib/db";

let db: Database;

async function token(symbol: string, snap: { mcap: number; h1: number; h6: number; h24: number; vol: number; buys: number; sells: number }, ageHours: number) {
  const [{ id }] = await db.query<{ id: string }>(
    `INSERT INTO token_assets (chain, address, symbol, name, pair_created_at) VALUES ('solana', $1, $1, $1, now() - make_interval(hours => $2)) RETURNING id`,
    [symbol, ageHours],
  );
  await db.query(
    `INSERT INTO market_snapshots (token_id, source, price_usd, market_cap, price_change_h1, price_change_h6, price_change_h24, volume_h24, buys_h24, sells_h24, liquidity_usd)
     VALUES ($1, 'test', 1, $2, $3, $4, $5, $6, $7, $8, 50000)`,
    [id, snap.mcap, snap.h1, snap.h6, snap.h24, snap.vol, snap.buys, snap.sells],
  );
}

const run = async (q: Record<string, string>) =>
  (await listTokens(tokenFilterSchema.parse(q), ["solana"], { advanced: true })).rows.map((r) => r.symbol).sort();

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  await token("FRESH", { mcap: 200_000, h1: 15, h6: 40, h24: 60, vol: 90_000, buys: 900, sells: 400 }, 3);
  await token("OLDBIG", { mcap: 9_000_000, h1: 2, h6: 5, h24: 10, vol: 2_000_000, buys: 5000, sells: 4800 }, 400);
  await token("QUIET", { mcap: 150_000, h1: -5, h6: -20, h24: -30, vol: 4_000, buys: 40, sells: 60 }, 5);
});

afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

describe("Screener filters", () => {
  it("applies max mcap, max pair age, min 24h txns and min 24h volume", async () => {
    expect(await run({ maxMcap: "1000000" })).toEqual(["FRESH", "QUIET"]);
    expect(await run({ maxAgeHours: "24" })).toEqual(["FRESH", "QUIET"]);
    expect(await run({ minTxnsH24: "500" })).toEqual(["FRESH", "OLDBIG"]);
    expect(await run({ minVolume: "50000", maxMcap: "1000000" })).toEqual(["FRESH"]);
  });

  it("applies 1h, 6h and 24h change ranges", async () => {
    expect(await run({ minChangeH1: "10" })).toEqual(["FRESH"]);
    expect(await run({ minChangeH6: "0", maxChangeH6: "10" })).toEqual(["OLDBIG"]);
    expect(await run({ maxChangeH24: "0" })).toEqual(["QUIET"]);
  });
});

describe("Screener templates", () => {
  it("stores only known filters", () => {
    expect(cleanParams({ maxMcap: "500000", minTxnsH24: " 300 ", page: "4", evil: "x", minVolume: "" })).toEqual({ maxMcap: "500000", minTxnsH24: "300" });
  });

  it("keeps each user's templates private", async () => {
    const [{ id: alice }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('a@tpl.dev') RETURNING id");
    const [{ id: bob }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('b@tpl.dev') RETURNING id");
    await withUser(alice, (tx) => tx.query("INSERT INTO screener_templates (user_id, name, params) VALUES ($1, 'Fresh', '{\"maxAgeHours\": \"24\"}')", [alice]));
    expect((await listTemplates(alice)).map((t) => t.name)).toEqual(["Fresh"]);
    expect(await listTemplates(bob)).toEqual([]);
    // Row-level security: Bob cannot write a template into Alice's account either.
    await expect(withUser(bob, (tx) => tx.query("INSERT INTO screener_templates (user_id, name) VALUES ($1, 'x')", [alice]))).rejects.toThrow();
  });
});

describe("Screener: liquidity ratio, launchpad, dev score, scam check, coverage", () => {
  beforeAll(async () => {
    const id = async (s: string) => (await db.query<{ id: string }>("SELECT id FROM token_assets WHERE symbol = $1", [s]))[0].id;
    await db.query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source) VALUES ('FRESH', 'pump', 'GoodDev', now(), 'stream'), ('QUIET', 'bonk', 'MehDev', now(), 'stream')`,
    );
    await db.query("INSERT INTO dev_profiles (creator, launches, migrated, score) VALUES ('GoodDev', 4, 2, 70), ('MehDev', 6, 0, 20)");
    await db.query("INSERT INTO launch_checks (mint, chain, passed, reason) VALUES ('FRESH', 'solana', true, 'ok'), ('QUIET', 'solana', false, 'Top 10 hold 60%')");
    for (const s of ["FRESH", "QUIET"]) await db.query("INSERT INTO token_security_checks (token_id, provider, status, risk_level) VALUES ($1, 'test', 'complete', 'low')", [await id(s)]);
  });

  it("filters by market cap ÷ liquidity (all pools are $50k here)", async () => {
    expect(await run({ maxMcapLiq: "10" })).toEqual(["FRESH", "QUIET"]); // 4× and 3×; OLDBIG is 180×
  });

  it("filters by launchpad origin and dev score, and labels each row's launchpad", async () => {
    expect(await run({ launchpad: "pump" })).toEqual(["FRESH"]);
    expect(await run({ launchpad: "pump,bonk" })).toEqual(["FRESH", "QUIET"]);
    expect(await run({ launchpad: "none" })).toEqual(["OLDBIG"]);
    expect(await run({ minDevScore: "60" })).toEqual(["FRESH"]);
    const rows = (await listTokens(tokenFilterSchema.parse({}), ["solana"], { advanced: true })).rows;
    expect(Object.fromEntries(rows.map((r) => [r.symbol, r.launchpad]))).toEqual({ FRESH: "pump", QUIET: "bonk", OLDBIG: null });
  });

  it("keeps only coins that pass the scam check (contract OK, and the launch check when there is one)", async () => {
    expect(await run({ scamCheck: "passed" })).toEqual(["FRESH"]); // QUIET failed its launch check; OLDBIG has no contract check
  });

  it("puts the new filters behind Pro and counts tracked pairs per chain", async () => {
    const free = await listTokens(tokenFilterSchema.parse({ minDevScore: "60" }), ["solana"], { advanced: false });
    expect(free.rows).toHaveLength(3);
    expect(free.restrictions[0]).toMatch(/require Pro/);
    expect(await screenerCoverage(["solana"])).toEqual({ total: 3, byChain: [{ chain: "solana", n: 3 }] });
  });
});

describe("Screener: DexScreener filter set", () => {
  beforeAll(async () => {
    const id = async (s: string) => (await db.query<{ id: string }>("SELECT id FROM token_assets WHERE symbol = $1", [s]))[0].id;
    // FRESH: hot on 5m, buy-heavy, PumpSwap, has socials. QUIET: sell-heavy on 6h, Raydium, boosted.
    const pair = async (symbol: string, dex: string) => {
      const [{ id: pairId }] = await db.query<{ id: string }>(
        "INSERT INTO market_pairs (token_id, chain, pair_address, dex_id, is_primary) VALUES ($1, 'solana', $2, $3, true) RETURNING id",
        [await id(symbol), `pair-${symbol}`, dex],
      );
      await db.query("UPDATE market_snapshots SET pair_id = $2 WHERE token_id = $1", [await id(symbol), pairId]);
    };
    await pair("FRESH", "pumpswap");
    await pair("QUIET", "raydium");
    await db.query("UPDATE market_snapshots SET price_change_m5 = 14, volume_m5 = 9000, buys_m5 = 60, sells_m5 = 10, buys_h6 = 400, sells_h6 = 100, fdv = 210000 WHERE token_id = $1", [await id("FRESH")]);
    await db.query("UPDATE market_snapshots SET price_change_m5 = -3, volume_m5 = 200, buys_m5 = 2, sells_m5 = 9, buys_h6 = 20, sells_h6 = 80, fdv = 900000 WHERE token_id = $1", [await id("QUIET")]);
    await db.query(`UPDATE token_assets SET metadata = metadata || '{"websites": ["https://fresh.example"]}' WHERE symbol = 'FRESH'`);
    await db.query(`UPDATE token_assets SET metadata = metadata || '{"promoted": true}' WHERE symbol = 'QUIET'`);
  });

  it("filters every timeframe with min and max, buys and sells separately", async () => {
    expect(await run({ minChangeM5: "10" })).toEqual(["FRESH"]);
    expect(await run({ maxChangeM5: "0" })).toEqual(["QUIET"]);
    expect(await run({ minVolumeM5: "5000", minTxnsM5: "50" })).toEqual(["FRESH"]);
    expect(await run({ minBuysH6: "300" })).toEqual(["FRESH"]);
    expect(await run({ minSellsH6: "50", maxBuysH6: "100" })).toEqual(["QUIET"]);
    expect(await run({ maxFdv: "500000" })).toEqual(["FRESH"]);
    expect(await run({ minTxnsH24: "500", maxTxnsH24: "2000" })).toEqual(["FRESH"]);
  });

  it("filters by DEX, profile and boosts", async () => {
    expect(await run({ dex: "pumpswap" })).toEqual(["FRESH"]);
    expect(await run({ dex: "pumpswap,raydium" })).toEqual(["FRESH", "QUIET"]);
    expect(await run({ profile: "1" })).toEqual(["FRESH"]);
    expect(await run({ boosted: "1" })).toEqual(["QUIET"]);
  });

  it("accepts every quick scan, and applies free filters while reporting locked ones on Free", async () => {
    for (const s of SCREENER_PRESETS) expect(Object.keys(s.params).every((k) => k in tokenFilterSchema.shape), s.key).toBe(true);
    const free = await listTokens(tokenFilterSchema.parse({ minLiquidity: "1", minChangeM5: "10" }), ["solana"], { advanced: false });
    expect(free.rows.map((r) => r.symbol).sort()).toEqual(["FRESH", "OLDBIG", "QUIET"]); // 5m change is Pro: not applied
    expect(free.restrictions[0]).toMatch(/require Pro/);
    const freeOnly = await listTokens(tokenFilterSchema.parse({ maxMcap: "1000000" }), ["solana"], { advanced: false });
    expect(freeOnly.restrictions).toEqual([]);
  });
});
