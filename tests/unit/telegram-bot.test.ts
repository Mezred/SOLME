import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { extractAddress, pollTelegramUpdates } from "@/lib/alerts/telegram";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";

let db: Database;
let updates: unknown[] = [];
let nextId = 100;
const calls: { method: string; chat_id: string; message_id?: number; text: string; reply_markup?: { inline_keyboard: { text: string }[][] } }[] = [];

// Fake Bot API: getUpdates returns the queued updates; sendMessage / editMessageText are recorded.
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const method = url.split("/").pop()!;
  const payload = JSON.parse(init.body);
  if (method === "sendMessage" || method === "editMessageText") calls.push({ method, ...payload });
  const result =
    method === "getUpdates" ? updates.filter((u) => (u as { update_id: number }).update_id >= (payload.offset ?? 0)) : method === "sendMessage" ? { message_id: nextId++ } : true;
  return new Response(JSON.stringify({ ok: true, result }));
});

const MINT = "9MGMMbtNPaVKjp2iwydnTM9rZTnGnB77xgUMQnASbJjP";
let updateId = 1;
const say = (text: string, chat = 777) => {
  updates = [{ update_id: updateId++, message: { text, chat: { id: chat, type: "private" } } }];
  return pollTelegramUpdates();
};

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
  (env as { heliusApiKey?: string }).heliusApiKey = undefined;
  vi.stubGlobal("fetch", fetchMock);
  const [{ id: userId }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('tgc@test.dev') RETURNING id");
  await db.query("INSERT INTO profiles (user_id, telegram_chat_id) VALUES ($1, '777')", [userId]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

beforeEach(() => {
  calls.length = 0;
});

describe("a contract sent to the bot", () => {
  it("finds the contract in a bare address or a link", () => {
    expect(extractAddress(MINT)).toBe(MINT);
    expect(extractAddress(`look https://pump.fun/coin/${MINT} ?`)).toBe(MINT);
    expect(extractAddress("hello there")).toBeNull();
  });

  it("gets a link to the coin's page, not a check (Coin Check was removed)", async () => {
    await say(`https://pump.fun/coin/${MINT}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendMessage");
    expect(calls[0].text).toContain("doesn't check coins");
    expect(calls[0].text).toContain(`/app/token/solana/${MINT}`);
  });

  it("only answers linked chats with a coin link", async () => {
    await say(MINT, 888);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("Connect Telegram");
  });

  it("lists the commands it still understands", async () => {
    await say("hi");
    expect(calls[0].text).toContain("/mutes");
    expect(calls[0].text).not.toMatch(/check a coin/i);
  });
});
