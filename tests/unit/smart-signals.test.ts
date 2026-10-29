import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { copyStats } from "@/lib/wallets/copy";

describe("if you copied a wallet", () => {
  it("enters at the detected buy price and exits at the wallet's next sell, or marks open trades to market", () => {
    const s = copyStats(
      [
        { token: "WIN", side: "buy", price: 1, time: 1 },
        { token: "WIN", side: "sell", price: 3, time: 2 }, // +200%
        { token: "HOLD", side: "buy", price: 2, time: 3 }, // still held, now 1.5: −25%
        { token: "RUG", side: "buy", price: 1, time: 4 }, // no market any more: −100%
        { token: "UNPRICED", side: "buy", price: 1, time: 5 }, // not priced this run: left out
        { token: "NOPRICE", side: "buy", price: null, time: 6 }, // no detection price: left out
      ],
      new Map([["HOLD", 1.5], ["RUG", null]]),
    );
    expect(s).toEqual({ trades: 3, closed: 1, wins: 1, avgReturn: 25, medianReturn: -25 });
  });

  it("reports nothing without a priced buy", () => {
    expect(copyStats([{ token: "X", side: "sell", price: 1, time: 1 }], new Map())).toEqual({ trades: 0, closed: 0, wins: 0, avgReturn: null, medianReturn: null });
  });
});

let db: Database;
let user: string;
const wallets: string[] = [];

async function swap(wallet: number, token: string, side: "buy" | "sell", minutesAgo: number, price: number, sol = 1) {
  const [{ id }] = await db.query<{ id: string }>(
    `INSERT INTO wallet_transactions (wallet_id, chain, tx_hash, block_time, direction, token_address, token_symbol, amount, provider, raw)
     VALUES ($1, 'solana', $2, now() - make_interval(mins => $3), $4, $5, $5, 1000, 'helius-rpc', $6) RETURNING id`,
    [wallets[wallet], `tx-${wallet}-${token}-${side}-${minutesAgo}`, minutesAgo, side, token, JSON.stringify({ sol, priceUsdAtDetection: price })],
  );
  return id;
}

const titles = async () => (await db.query<{ title: string; meta: { replyTo?: string } }>("SELECT title, meta FROM notifications WHERE user_id = $1 ORDER BY created_at, title", [user]));

describe("group buys and smart-wallet sells", () => {
  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
    [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('sm@test.dev') RETURNING id");
    for (let i = 0; i < 4; i++) {
      const [{ id }] = await db.query<{ id: string }>("INSERT INTO wallet_profiles (chain, address) VALUES ('solana', $1) RETURNING id", [`SmartWallet${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`]);
      await db.query(
        `INSERT INTO wallet_scores (wallet_id, version, score, trades, decided_positions, open_positions, wins, losses, pnl_sol, early_entries, early_hits)
         VALUES ($1, 'v1', 80, 10, 8, 0, 6, 2, 5, 1, 1)`,
        [id],
      );
      wallets.push(id);
    }
  });
  afterAll(async () => {
    setDbOverride(undefined);
    await db.close();
  });

  it("alerts once when 3 smart wallets buy the same coin within the window", async () => {
    await db.query(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, created_at) VALUES ($1, 'Group', 'smart_group_buy', '{"min_wallets": 3, "window_minutes": 10, "min_wallet_score": 60}', '{in_app}', now() - interval '1 hour')`,
      [user],
    );
    await swap(0, "HOT", "buy", 8, 0.001);
    await swap(1, "HOT", "buy", 5, 0.0012);
    await swap(2, "OLD", "buy", 30, 0.001); // outside the window
    expect(await evaluateAlerts(["smart_group_buy"])).toBe(0); // only 2 wallets so far
    await swap(2, "HOT", "buy", 1, 0.0015);
    expect(await evaluateAlerts(["smart_group_buy"])).toBe(1);
    await swap(3, "HOT", "buy", 0, 0.002);
    expect(await evaluateAlerts(["smart_group_buy"])).toBe(0); // same coin, same day
    expect((await titles()).map((t) => t.title)).toEqual(["3 smart wallets bought HOT within 7 min"]);
  });

  it("follows a buy alert with a sell alert, replying to it, only for buys that were alerted", async () => {
    const [{ id: ruleId }] = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, created_at) VALUES ($1, 'Buys', 'smart_wallet_buy', '{"min_wallet_score": 60, "min_buy_sol": 0}', '{in_app}', now() - interval '1 hour') RETURNING id`,
      [user],
    );
    const address = `SmartWallet0xxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
    // An earlier buy alert this rule sent for wallet 0 / PUMPY.
    await swap(0, "PUMPY", "buy", 20, 0.01);
    const [{ id: ev }] = await db.query<{ id: string }>(
      "INSERT INTO alert_events (rule_id, user_id, dedup_key, payload, triggered_at) VALUES ($1, $2, 'swb:earlier', $3, now() - interval '19 minutes') RETURNING id",
      [ruleId, user, JSON.stringify({ mint: "PUMPY", wallet: address })],
    );
    await db.query("INSERT INTO notifications (user_id, alert_event_id, channel, title, body, status) VALUES ($1, $2, 'in_app', 'buy', 'b', 'sent')", [user, ev]);
    await swap(0, "PUMPY", "sell", 2, 0.015, 3);
    await swap(1, "QUIET", "sell", 2, 0.02); // never alerted: no follow-up

    await evaluateAlerts(["smart_wallet_buy"]);
    const sold = (await titles()).filter((t) => t.title.startsWith("Smart wallet sold"));
    expect(sold.map((t) => t.title)).toEqual(["Smart wallet sold PUMPY (+50.0% since the buy alert)"]);
    expect(sold[0].meta.replyTo).toBe("PUMPY");
    await evaluateAlerts(["smart_wallet_buy"]);
    expect((await titles()).filter((t) => t.title.startsWith("Smart wallet sold"))).toHaveLength(1);
  });
});
