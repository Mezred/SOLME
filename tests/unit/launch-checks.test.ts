import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";
import { checkFreshLaunches, checkNewLaunches } from "@/lib/launchpad/checks";

let db: Database;
const edits: { chat_id: string; message_id: number; text: string; reply_markup?: unknown }[] = [];

// Fake Bot API: records editMessageText calls.
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  if (url.endsWith("/editMessageText")) edits.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ ok: true, result: true }));
});

/** A proven-dev launch already trading on a DEX, with a contract scan of the given risk. */
async function launch(mint: string, risk: string, minutesAgo = 10) {
  await db.query(
    "INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, progress, dev_score_at_launch, dev_launches_at_launch) VALUES ($1, 'pump', 'ProvenDev', now() - make_interval(mins => $2), 'stream', 0.4, 80, 5)",
    [mint, minutesAgo],
  );
  const [{ id }] = await db.query<{ id: string }>("INSERT INTO token_assets (chain, address, symbol, name) VALUES ('solana', $1, $1, $1) RETURNING id", [mint]);
  await db.query(
    "INSERT INTO market_snapshots (token_id, source, price_usd, price_change_h1, price_change_h24, liquidity_usd, buys_h1, sells_h1) VALUES ($1, 'test', 0.001, 5, 5, 80000, 50, 20)",
    [id],
  );
  await db.query("INSERT INTO token_security_checks (token_id, provider, status, risk_level) VALUES ($1, 'test', 'complete', $2)", [id, risk]);
}

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  // No holder provider in tests: the check runs on contract, exit and flow only.
  (env as { heliusApiKey?: string }).heliusApiKey = undefined;
  (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
  vi.stubGlobal("fetch", fetchMock);
  await db.query("INSERT INTO dev_profiles (creator, launches, migrated, score) VALUES ('ProvenDev', 5, 2, 80)");
  await launch("GoodMint", "low");
  await launch("BadMint", "critical");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

describe("background scam check for fresh launches", () => {
  it("records pass / fail per coin and does not re-check within the hour", async () => {
    expect(await checkFreshLaunches()).toBe(2);
    const rows = await db.query<{ mint: string; passed: boolean; reason: string }>("SELECT mint, passed, reason FROM launch_checks ORDER BY mint");
    expect(rows.map((r) => [r.mint, r.passed])).toEqual([["BadMint", false], ["GoodMint", true]]);
    expect(rows[0].reason).toMatch(/critical/i);
    expect(await checkFreshLaunches()).toBe(0);
    expect(await checkNewLaunches()).toBe(0);
  });

  it("checks a new proven-dev launch right away and edits the Telegram alert already sent for it", async () => {
    await launch("FreshMint", "low", 1);
    const [{ id: userId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('t@test.dev') RETURNING id");
    const card = { icon: "🚀", headline: "Proven dev just launched", symbol: "FRESH", chain: "solana", pool: "pump", address: "FreshMint", facts: [], check: { status: "pending" } };
    await db.query(
      `INSERT INTO notifications (user_id, channel, title, body, link, status, meta, tg_chat_id, tg_message_id)
       VALUES ($1, 'telegram', 't', 'b', '/app/smart-dev', 'sent', $2, '777', 42)`,
      [userId, JSON.stringify(card)],
    );

    expect(await checkNewLaunches()).toBe(1);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ chat_id: "777", message_id: 42 });
    expect(edits[0].text).toContain("✅ <b>Scam check passed</b> — No safety check failed");
    expect(edits[0].reply_markup).toBeDefined(); // buttons kept
    const [n] = await db.query<{ meta: { check: { status: string } } }>("SELECT meta FROM notifications WHERE tg_message_id = 42");
    expect(n.meta.check.status).toBe("passed");

    // Same result again: no second edit.
    await db.query("UPDATE launch_checks SET checked_at = now() - interval '2 hours' WHERE mint = 'FreshMint'");
    await checkFreshLaunches();
    expect(edits).toHaveLength(1);
  });
});
