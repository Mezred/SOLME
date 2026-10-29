import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pollTelegramUpdates } from "@/lib/alerts/telegram";
import { extractAddress, TG_CHECK_LIMIT } from "@/lib/alerts/telegram-check";
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
  // A tracked Solana coin with a critical contract finding: the check must say Avoid.
  const [{ id }] = await db.query<{ id: string }>("INSERT INTO token_assets (chain, address, symbol, name) VALUES ('solana', $1, 'RUGGY', 'Ruggy') RETURNING id", [MINT]);
  await db.query(
    "INSERT INTO market_snapshots (token_id, source, price_usd, price_change_h1, price_change_h24, liquidity_usd, buys_h1, sells_h1) VALUES ($1, 'test', 0.001, 5, 5, 80000, 50, 20)",
    [id],
  );
  await db.query("INSERT INTO token_security_checks (token_id, provider, status, risk_level) VALUES ($1, 'test', 'complete', 'critical')", [id]);
  await db.query("INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source) VALUES ($1, 'pump', 'Dev', now(), 'stream')", [MINT]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

beforeEach(() => {
  calls.length = 0;
});

describe("check a coin from Telegram", () => {
  it("finds the contract in a bare address or a link", () => {
    expect(extractAddress(MINT)).toBe(MINT);
    expect(extractAddress(`look https://pump.fun/coin/${MINT} ?`)).toBe(MINT);
    expect(extractAddress("ca: 0xAbC0000000000000000000000000000000000001")).toBe("0xAbC0000000000000000000000000000000000001");
    expect(extractAddress("hello there")).toBeNull();
  });

  it("answers at once, then edits that message into the verdict with copyable contract and buttons", async () => {
    await say(`https://pump.fun/coin/${MINT}`);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage", "editMessageText"]);
    expect(calls[0].text).toBe("🔎 Checking…");
    const result = calls[1];
    expect(result.message_id).toBe(calls[0].message_id ?? 100);
    expect(result.text).toContain("⛔ <b>CHECK: AVOID</b>");
    expect(result.text).toContain("<b>$RUGGY</b> · Solana · pump.fun");
    expect(result.text).toContain(`<code>${MINT}</code>`);
    expect(result.text).toContain("• Who controls it?: <b>❌ critical risk");
    expect(result.text).toContain("Reasons to buy");
    expect(result.reply_markup!.inline_keyboard.flat().map((b) => b.text)).toEqual(["DexScreener", "pump.fun", "Explorer"]);
  });

  it("only answers linked chats", async () => {
    await say(MINT, 888);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("Connect Telegram");
  });

  it("serves a repeat from cache and rate-limits new checks per chat", async () => {
    await say(MINT);
    expect(calls[1].text).toContain("CHECK: AVOID"); // cached: no new check, no rate-limit hit
    calls.length = 0;
    // Use up the budget in this window and the next one (so the test cannot straddle a window boundary).
    const [{ user_id }] = await db.query<{ user_id: string }>("SELECT user_id FROM profiles WHERE telegram_chat_id = '777'");
    const ms = TG_CHECK_LIMIT.windowSeconds * 1000;
    const start = Math.floor(Date.now() / ms) * ms;
    for (const w of [start, start + ms]) {
      await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3) ON CONFLICT (key, window_start) DO UPDATE SET count = EXCLUDED.count", [
        `tgcheck:${user_id}`,
        new Date(w),
        TG_CHECK_LIMIT.count,
      ]);
    }
    await say(`So1ana${"1".repeat(30)}Z`);
    expect(calls.at(-1)!.text).toMatch(/^⏱ 10 checks per 5 minutes/);
  });
});
