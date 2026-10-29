import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";
import { checkFeeds } from "@/lib/jobs/feed-health";

let db: Database;
const sent: { chat_id: string; text: string }[] = [];

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    if (url.endsWith("/sendMessage")) sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
  const [{ id: admin }] = await db.query<{ id: string }>("INSERT INTO users (email, role_id) VALUES ('admin@test.dev', 3) RETURNING id");
  await db.query("INSERT INTO profiles (user_id, telegram_chat_id) VALUES ($1, '555')", [admin]);
  const [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('user@test.dev') RETURNING id");
  await db.query("INSERT INTO profiles (user_id, telegram_chat_id) VALUES ($1, '777')", [user]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

describe("live feed health", () => {
  it("tells admins (only) once when a feed goes down, then when it is back with the gap", async () => {
    const t0 = Date.parse("2026-10-28T12:00:00Z");
    const down = [{ feed: "launchpad" as const, ok: false, detail: "last message 200s ago" }, { feed: "wallets" as const, ok: true, detail: "12 addresses live" }];
    await checkFeeds(t0, down);
    await checkFeeds(t0 + 60_000, down); // still down: no repeat
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat_id: "555", text: expect.stringContaining("Launch feed (PumpPortal) is down") });

    await checkFeeds(t0 + 12 * 60_000, [{ feed: "launchpad", ok: true, detail: "last message 2s ago" }]);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe("✅ Launch feed (PumpPortal) is back after 12 min.");

    const [{ value }] = await db.query<{ value: { gaps: { feed: string }[]; incidents: object; states: { feed: string; ok: boolean }[] } }>(
      "SELECT value FROM app_settings WHERE key = 'feed_health'",
    );
    expect(value.gaps).toEqual([{ feed: "launchpad", from: "2026-10-28T12:00:00.000Z", to: "2026-10-28T12:12:00.000Z" }]);
    expect(value.incidents).toEqual({});
    expect(value.states).toEqual([{ feed: "launchpad", ok: true, detail: "last message 2s ago" }]);
  });
});
