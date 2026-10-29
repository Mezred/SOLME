import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyDatabase } from "@/lib/db/copy";
import { createTestDb, type Database } from "@/lib/db";

let src: Database;
let dst: Database;

beforeAll(async () => {
  [src, dst] = await Promise.all([createTestDb(), createTestDb()]);
  const [{ id: user }] = await src.query<{ id: string }>("INSERT INTO users (email) VALUES ('me@test.dev') RETURNING id");
  await src.query("INSERT INTO profiles (user_id, telegram_chat_id, quiet_start, quiet_end) VALUES ($1, '777', '23:00', '07:00')", [user]);
  const [{ id: token }] = await src.query<{ id: string }>("INSERT INTO token_assets (chain, address, symbol, name, metadata) VALUES ('solana', 'Mint1', 'ONE', 'One', '{\"last_score\": {\"ai\": 80}}') RETURNING id");
  await src.query("INSERT INTO market_snapshots (token_id, source, price_usd) VALUES ($1, 'test', 0.5)", [token]);
  await src.query("INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'Dev', 'dev_deploy', '{\"min_dev_score\": 60}', '{in_app,telegram}')", [user]);
  // An admin edit of seeded data must survive (the target's own seed is replaced).
  await src.query("UPDATE subscription_plans SET name = 'Pro (edited)' WHERE id = 'pro'");
  // A bigserial row, so the target's counter must move past it.
  await src.query("INSERT INTO jobs (type, payload) VALUES ('test.job', '{}')");
});

afterAll(async () => {
  await Promise.all([src.close(), dst.close()]);
});

describe("copy PGlite → Postgres", () => {
  it("copies every table, keeps admin edits and JSON/array columns, and moves counters past copied ids", async () => {
    const results = await copyDatabase(src, dst);
    const count = (t: string) => results.find((r) => r.table === t)?.rows;
    expect([count("users"), count("profiles"), count("token_assets"), count("market_snapshots"), count("alert_rules")]).toEqual([1, 1, 1, 1, 1]);
    // Parents before children.
    const order = results.map((r) => r.table);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("profiles"));
    expect(order.indexOf("token_assets")).toBeLessThan(order.indexOf("market_snapshots"));

    const [p] = await dst.query<{ quiet_start: string; telegram_chat_id: string }>("SELECT quiet_start, telegram_chat_id FROM profiles");
    expect(p).toEqual({ quiet_start: "23:00", telegram_chat_id: "777" });
    const [r] = await dst.query<{ channels: string[]; params: { min_dev_score: number } }>("SELECT channels, params FROM alert_rules");
    expect(r).toEqual({ channels: ["in_app", "telegram"], params: { min_dev_score: 60 } });
    expect((await dst.query<{ name: string }>("SELECT name FROM subscription_plans WHERE id = 'pro'"))[0].name).toBe("Pro (edited)");

    const [{ max }] = await src.query<{ max: number }>("SELECT max(id) AS max FROM jobs");
    const [{ id }] = await dst.query<{ id: number }>("INSERT INTO jobs (type, payload) VALUES ('after.copy', '{}') RETURNING id");
    expect(Number(id)).toBeGreaterThan(Number(max));
  });

  it("refuses to overwrite a target that already has users", async () => {
    await expect(copyDatabase(src, dst)).rejects.toThrow(/already has 1 user/);
    await expect(copyDatabase(src, dst, { force: true })).resolves.toBeTruthy();
  });
});
