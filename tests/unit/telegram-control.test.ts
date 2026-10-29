import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverNotifications, evaluateAlerts } from "@/lib/alerts/engine";
import { pollTelegramUpdates } from "@/lib/alerts/telegram";
import { formatTelegramAlert, formatTelegramDigest, inQuietHours, muteData, parseMuteData } from "@/lib/alerts/telegram-format";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";

const MINT = "9MGMMbtNPaVKjp2iwydnTM9rZTnGnB77xgUMQnASbJjP";
const DEV = "DevWa11et11111111111111111111111111111111111";

describe("Telegram alert controls (pure)", () => {
  it("adds mute buttons on their own row and round-trips their data", () => {
    const m = formatTelegramAlert({ icon: "🚀", headline: "x", chain: "solana", address: MINT, facts: [], mute: [{ kind: "dev", value: DEV }, { kind: "coin", value: MINT }] }, null);
    expect(m.buttons.at(-1)).toEqual([{ text: "🔕 Dev 24h", callback_data: `m:d:${DEV}` }, { text: "🔕 Coin 24h", callback_data: `m:c:${MINT}` }]);
    expect(muteData({ kind: "wallet", value: MINT }).length).toBeLessThanOrEqual(64);
    expect(parseMuteData(`m:w:${MINT}`)).toEqual({ kind: "wallet", value: MINT });
    expect(parseMuteData("m:x:nope")).toBeNull();
  });

  it("knows when quiet hours apply, across midnight and in the user's timezone", () => {
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours("23:00", "07:00", "UTC", at("2026-10-28T02:00:00Z"))).toBe(true);
    expect(inQuietHours("23:00", "07:00", "UTC", at("2026-10-28T12:00:00Z"))).toBe(false);
    expect(inQuietHours("01:00", "08:00", "UTC", at("2026-10-28T08:00:00Z"))).toBe(false); // end is exclusive
    // 22:30 UTC is 01:30 in Riyadh (UTC+3).
    expect(inQuietHours("01:00", "08:00", "Asia/Riyadh", at("2026-10-28T22:30:00Z"))).toBe(true);
    expect(inQuietHours(null, null, "UTC")).toBe(false);
  });

  it("lists many alerts in one message with each contract copyable", () => {
    const text = formatTelegramDigest("🌙 3 alerts", [
      { title: "a", card: { icon: "🚀", headline: "Proven dev just launched", symbol: "ONE", address: MINT, facts: [] } },
      { title: "Plain <title>", card: null },
      { title: "c", card: { icon: "👥", headline: "3 smart wallets bought", symbol: "TWO", facts: [] } },
    ], 2);
    expect(text.split("\n")).toEqual(["<b>🌙 3 alerts</b>", "", "• 🚀 Proven dev just launched <b>$ONE</b>", `   <code>${MINT}</code>`, "• Plain &lt;title&gt;", "", "…and 1 more in SOLME → Alerts."]);
  });
});

let db: Database;
let user: string;
let nextId = 900;
let updates: unknown[] = [];
const calls: { method: string; chat_id?: string; text?: string; callback_query_id?: string }[] = [];
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const method = url.split("/").pop()!;
  const payload = JSON.parse(init.body);
  if (method !== "getUpdates") calls.push({ method, ...payload });
  const result = method === "getUpdates" ? updates.filter((u) => (u as { update_id: number }).update_id >= (payload.offset ?? 0)) : method === "sendMessage" ? { message_id: nextId++ } : true;
  return new Response(JSON.stringify({ ok: true, result }));
});

const card = (symbol: string) => JSON.stringify({ icon: "🚀", headline: "Proven dev just launched", symbol, chain: "solana", address: MINT, facts: [] });
const pending = (n: number) =>
  db.query(
    `INSERT INTO notifications (user_id, channel, title, body, status, meta) SELECT $1, 'telegram', 'alert ' || i, 'b', 'pending', $2 FROM generate_series(1, $3) AS i`,
    [user, card("BURST"), n],
  );

describe("Telegram alert controls (bot and delivery)", () => {
  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
    (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
    vi.stubGlobal("fetch", fetchMock);
    [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('ctl@test.dev') RETURNING id");
    await db.query("INSERT INTO profiles (user_id, telegram_chat_id, notify_telegram) VALUES ($1, '777', true)", [user]);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    setDbOverride(undefined);
    await db.close();
  });
  beforeEach(async () => {
    calls.length = 0;
    await db.query("DELETE FROM notifications");
  });

  it("mutes a dev from the alert button, and the next launch by that dev stays silent", async () => {
    updates = [{ update_id: 1, callback_query: { id: "cb1", data: `m:d:${DEV}`, message: { chat: { id: 777, type: "private" } } } }];
    await pollTelegramUpdates();
    expect(calls).toEqual([expect.objectContaining({ method: "answerCallbackQuery", callback_query_id: "cb1", text: expect.stringContaining("Muted this dev for 24h") })]);

    await db.query(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, created_at) VALUES ($1, 'Proven', 'dev_deploy', '{"min_dev_score": 60}', '{in_app}', now() - interval '1 hour')`,
      [user],
    );
    await db.query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, dev_score_at_launch, dev_launches_at_launch)
       VALUES ('MutedDevMint', 'pump', $1, now() - interval '1 minute', 'stream', 80, 4), ('OtherDevMint', 'pump', 'OtherDev', now() - interval '1 minute', 'stream', 80, 4)`,
      [DEV],
    );
    expect(await evaluateAlerts(["dev_deploy"])).toBe(1); // only the un-muted dev's launch
    const [n] = await db.query<{ meta: { address: string; mute: { kind: string }[] } }>("SELECT meta FROM notifications WHERE user_id = $1", [user]);
    expect(n.meta.address).toBe("OtherDevMint");
    expect(n.meta.mute.map((m) => m.kind)).toEqual(["dev", "coin"]);

    calls.length = 0;
    updates = [{ update_id: 2, message: { text: "/unmute", chat: { id: 777, type: "private" } } }];
    await pollTelegramUpdates();
    expect((await db.query("SELECT 1 FROM alert_mutes")).length).toBe(0);
  });

  it("holds alerts during quiet hours and sends them as one summary afterwards", async () => {
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    const now = Date.now();
    await db.query("UPDATE profiles SET timezone = 'UTC', quiet_start = $2, quiet_end = $3 WHERE user_id = $1", [user, hhmm(new Date(now - 3_600_000)), hhmm(new Date(now + 3_600_000))]);
    await pending(2);
    await deliverNotifications();
    expect(calls).toHaveLength(0);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE digest AND status = 'pending'"))[0].n).toBe(2);

    await db.query("UPDATE profiles SET quiet_start = NULL, quiet_end = NULL WHERE user_id = $1", [user]);
    await deliverNotifications();
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("While your quiet hours were on: 2 alerts");
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE status = 'sent'"))[0].n).toBe(2);
  });

  it("paces a burst: a few alerts on their own, the rest in one message", async () => {
    await pending(6);
    await deliverNotifications();
    expect(calls.map((c) => (c.text?.startsWith("<b>+") ? "digest" : "alert"))).toEqual(["alert", "alert", "alert", "alert", "digest"]);
    expect(calls[4].text).toContain("+2 more alerts just now");
  });
});
