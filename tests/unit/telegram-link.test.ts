import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pollTelegramUpdates, telegramLinkUrl } from "@/lib/alerts/telegram";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";

let db: Database;
let userId: string;
let updates: unknown[] = [];
const sent: { chat_id: string; text: string }[] = [];

// Fake Bot API: getMe, getUpdates (returns the queued updates) and sendMessage (recorded).
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const method = url.split("/").pop();
  const payload = JSON.parse(init.body);
  const result = method === "getMe" ? { username: "Test_bot" } : method === "getUpdates" ? updates.filter((u) => (u as { update_id: number }).update_id >= (payload.offset ?? 0)) : true;
  if (method === "sendMessage") sent.push(payload);
  return new Response(JSON.stringify({ ok: true, result }));
});

const message = (update_id: number, text: string, chat = 777) => ({ update_id, message: { text, chat: { id: chat, type: "private" } } });

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
  vi.stubGlobal("fetch", fetchMock);
  [{ id: userId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('tg@test.dev') RETURNING id");
  await db.query("INSERT INTO profiles (user_id) VALUES ($1)", [userId]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe("Telegram one-click linking", () => {
  it("links the chat that presses Start on the deep link, once", async () => {
    const url = await telegramLinkUrl(userId);
    expect(url).toMatch(/^https:\/\/t\.me\/Test_bot\?start=[\w-]{20,64}$/);
    const token = new URL(url).searchParams.get("start")!;

    updates = [message(5, `/start ${token}`)];
    expect(await pollTelegramUpdates()).toBe(1);
    const [p] = await db.query<{ telegram_chat_id: string; notify_telegram: boolean }>("SELECT telegram_chat_id, notify_telegram FROM profiles WHERE user_id = $1", [userId]);
    expect(p.telegram_chat_id).toBe("777");
    // Free plan: linked, but Telegram delivery stays off until an upgrade.
    expect(p.notify_telegram).toBe(false);
    expect(sent[0].text).toContain("Connected");

    // The offset advanced, so the same update is not handled again.
    expect(await pollTelegramUpdates()).toBe(0);

    // A replayed token from another chat does not steal the link.
    updates = [message(6, `/start ${token}`, 888)];
    await pollTelegramUpdates();
    const [after] = await db.query<{ telegram_chat_id: string }>("SELECT telegram_chat_id FROM profiles WHERE user_id = $1", [userId]);
    expect(after.telegram_chat_id).toBe("777");
    expect(sent.at(-1)).toMatchObject({ chat_id: "888" });
    expect(sent.at(-1)!.text).toContain("Connect Telegram");
  });

  it("pauses alerts on /stop from a linked chat", async () => {
    await db.query("UPDATE profiles SET notify_telegram = true WHERE user_id = $1", [userId]);
    updates = [message(7, "/stop")];
    await pollTelegramUpdates();
    const [p] = await db.query<{ notify_telegram: boolean }>("SELECT notify_telegram FROM profiles WHERE user_id = $1", [userId]);
    expect(p.notify_telegram).toBe(false);
    expect(sent[0].text).toContain("paused");
  });
});
