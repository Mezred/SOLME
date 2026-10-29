import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";

let db: Database;
let user: string;
let ruleId: string;

/** A Solana pair `hours` old with the given 24h volume and transaction count. */
async function coin(symbol: string, hours: number, volume: number, txns: number) {
  const [{ id }] = await db.query<{ id: string }>(
    "INSERT INTO token_assets (chain, address, symbol, name, pair_created_at) VALUES ('solana', $1, $1, $1, now() - make_interval(hours => $2)) RETURNING id",
    [symbol, hours],
  );
  await db.query(
    `INSERT INTO market_snapshots (token_id, source, price_usd, price_change_h1, price_change_h6, price_change_h24, liquidity_usd, market_cap, volume_h24, buys_h24, sells_h24)
     VALUES ($1, 'test', 0.01, 12, 30, 80, 40000, 300000, $2, $3, 0)`,
    [id, volume, txns],
  );
  return id;
}

const notifications = () => db.query<{ title: string; meta: { headline: string; facts: [string, string][] } }>("SELECT title, meta FROM notifications WHERE user_id = $1 ORDER BY created_at", [user]);

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('screen@test.dev') RETURNING id");
  // Free-plan filters only: pair age ≤ 24h, 24h volume ≥ $50k, 24h txns ≥ 500.
  const [{ id: tpl }] = await db.query<{ id: string }>(
    `INSERT INTO screener_templates (user_id, name, params) VALUES ($1, 'Fresh movers', '{"chain": "solana", "maxAgeHours": "24", "minVolume": "50000", "minTxnsH24": "500"}') RETURNING id`,
    [user],
  );
  [{ id: ruleId }] = await db.query<{ id: string }>(
    `INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'Screener: Fresh movers', 'screener_match', $2, '{in_app}') RETURNING id`,
    [user, JSON.stringify({ template_id: tpl })],
  );
});

afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

describe("Screener templates as alerts", () => {
  it("stays quiet about coins that already matched when the alert was switched on", async () => {
    await coin("OLDMATCH", 3, 90_000, 900);
    await coin("NOMATCH", 3, 1_000, 900); // too little volume
    expect(await evaluateAlerts()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("alerts once when a coin starts matching, with the numbers that matched", async () => {
    await coin("NEWBIE", 1, 120_000, 2_400);
    expect(await evaluateAlerts()).toBe(1);
    const [n] = await notifications();
    expect(n.title).toBe('NEWBIE matches your "Fresh movers" filters');
    expect(n.meta.headline).toBe('Matches "Fresh movers"');
    expect(Object.fromEntries(n.meta.facts)).toMatchObject({ "Volume 24h": "$120.0K", "Txns 24h": "2,400", "1h / 6h / 24h": "+12.0% / +30.0% / +80.0%" });

    expect(await evaluateAlerts()).toBe(0); // same coin, still matching: no repeat
    expect(await notifications()).toHaveLength(1);
  });

  it("does nothing once the template is gone", async () => {
    await db.query("DELETE FROM screener_templates WHERE user_id = $1", [user]);
    await coin("LATER", 1, 120_000, 2_400);
    expect(await evaluateAlerts()).toBe(0);
    expect((await db.query("SELECT 1 FROM alert_rules WHERE id = $1", [ruleId])).length).toBe(1);
  });
});
