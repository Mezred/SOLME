import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverNotifications, evaluateAlerts } from "@/lib/alerts/engine";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { env } from "@/lib/env";
import { launchFacts, updateSentAlerts } from "@/lib/launchpad/checks";
import { recordDevSell } from "@/lib/wallets/live";

let db: Database;
let user: string;
let ruleId: string;
const calls: { method: string; chat_id: string; text: string; message_id?: number; reply_parameters?: { message_id: number } }[] = [];

// Fake Bot API: records sendMessage / editMessageText, hands out message ids.
let nextId = 500;
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const method = url.split("/").pop()!;
  if (method === "sendMessage" || method === "editMessageText") calls.push({ method, ...JSON.parse(init.body) });
  return new Response(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: nextId++ } : true }));
});

const sell = (mint: string, tokenAmount: number, signature: string) => ({ signature, slot: 1, time: Math.floor(Date.now() / 1000), mint, side: "sell" as const, tokenAmount, sol: 4.2 });

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  (env as { telegramBotToken?: string }).telegramBotToken = "123:test";
  vi.stubGlobal("fetch", fetchMock);
  [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('dev@test.dev') RETURNING id");
  [{ id: ruleId }] = await db.query<{ id: string }>(
    `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, created_at) VALUES ($1, 'Proven dev', 'dev_deploy', '{"min_dev_score": 60}', '{in_app}', now() - interval '1 hour') RETURNING id`,
    [user],
  );
  await db.query(
    `INSERT INTO launchpad_tokens (mint, pool, creator, symbol, created_at, source, initial_buy_sol, dev_score_at_launch, dev_launches_at_launch)
     VALUES ('DevMint', 'pump', 'Creator1', 'DEVC', now() - interval '5 minutes', 'stream', 1.5, 80, 4),
            ('OtherMint', 'pump', 'SomeoneElse', 'OTH', now() - interval '5 minutes', 'stream', 0, 10, 1)`,
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDbOverride(undefined);
  await db.close();
});

beforeEach(() => {
  calls.length = 0;
});

const events = async (prefix: string) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM alert_events WHERE rule_id = $1 AND dedup_key LIKE $2", [ruleId, `${prefix}%`]))[0].n;

describe("dev sold follow-up", () => {
  it("adds the dev buy to the launch alert", async () => {
    await evaluateAlerts(["dev_deploy"]);
    const [n] = await db.query<{ meta: { facts: [string, string][] } }>("SELECT meta FROM notifications WHERE user_id = $1", [user]);
    expect(Object.fromEntries(n.meta.facts)).toMatchObject({ "Dev score": "80", "Dev buy": "1.5 SOL" });
  });

  it("records only the creator's sales of their own recent launch", async () => {
    expect(await recordDevSell("Creator1", sell("OtherMint", 1, "s0"))).toBe(false); // not their coin
    expect(await recordDevSell("Creator1", sell("DevMint", 50_000_000, "s1"))).toBe(true);
    expect(await recordDevSell("Creator1", sell("DevMint", 50_000_000, "s1"))).toBe(false); // same transaction
    const [r] = await db.query<{ supply_pct: number }>("SELECT supply_pct FROM dev_sells WHERE signature = 's1'");
    expect(Number(r.supply_pct)).toBe(5); // 50M of pump.fun's fixed 1B supply
  });

  it("alerts each sale once, under a coin this rule already alerted, with the running total", async () => {
    expect(await evaluateAlerts(["dev_deploy"])).toBe(1);
    await recordDevSell("Creator1", sell("DevMint", 100_000_000, "s2"));
    expect(await evaluateAlerts(["dev_deploy"])).toBe(1);
    expect(await evaluateAlerts(["dev_deploy"])).toBe(0);
    expect(await events("devsell:")).toBe(2);
    const [last] = await db.query<{ title: string; meta: { facts: [string, string][]; replyTo: string } }>(
      "SELECT title, meta FROM notifications WHERE user_id = $1 AND title LIKE 'Dev sold%' ORDER BY created_at DESC LIMIT 1",
      [user],
    );
    expect(last.title).toBe("Dev sold DEVC: 10.0% of supply");
    expect(Object.fromEntries(last.meta.facts)).toEqual({ "This sale": "10.0% of supply · 4.2 SOL", "Sold so far": "15.0% of supply" });
    expect(last.meta.replyTo).toBe("DevMint");
  });

  it("sends the dev-sold message as a Telegram reply to the launch alert", async () => {
    await db.query("INSERT INTO profiles (user_id, telegram_chat_id) VALUES ($1, '777') ON CONFLICT (user_id) DO UPDATE SET telegram_chat_id = '777'", [user]);
    const card = (headline: string, extra: object) => JSON.stringify({ icon: "🚀", headline, symbol: "DEVC", chain: "solana", pool: "pump", address: "DevMint", facts: [], ...extra });
    await db.query(
      `INSERT INTO notifications (user_id, channel, title, body, status, meta, tg_chat_id, tg_message_id, created_at)
       VALUES ($1, 'telegram', 'launch', 'b', 'sent', $2, '777', 42, now() - interval '2 minutes')`,
      [user, card("Proven dev just launched", { check: { status: "pending" } })],
    );
    await db.query("INSERT INTO notifications (user_id, channel, title, body, status, meta) VALUES ($1, 'telegram', 'sold', 'b', 'pending', $2)", [user, card("Dev sold", { replyTo: "DevMint" })]);
    await deliverNotifications();
    const sent = calls.find((c) => c.text.includes("DEV SOLD"))!;
    expect(sent.reply_parameters).toMatchObject({ message_id: 42 });
  });

  it("adds bundle and sniper numbers to the alert already sent, once", async () => {
    const facts = launchFacts({ bundlePct: 12.34, bundleWallets: 3, sniperWallets: 7, sniperPct: 21 });
    expect(await updateSentAlerts("DevMint", { facts })).toBe(1);
    const edit = calls.find((c) => c.method === "editMessageText")!;
    expect(edit.message_id).toBe(42);
    expect(edit.text).toContain("• Launch bundle: <b>12.3% of supply · 3 wallets</b>");
    expect(edit.text).toContain("• Snipers (first 10s): <b>7 wallets · 21.0%</b>");
    expect(edit.text).toContain("⏳ <b>Scam check running…</b>"); // the check line is kept
    expect(await updateSentAlerts("DevMint", { facts })).toBe(0);
  });
});
