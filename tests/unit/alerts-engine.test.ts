import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";

let db: Database;
let user: string;

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('trader@test.dev') RETURNING id");
});

afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

const rule = async (type: string, params: object) =>
  (
    await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, created_at) VALUES ($1, $2, $3, $4, '{in_app}', now() - interval '1 hour') RETURNING id`,
      [user, type, type, JSON.stringify(params)],
    )
  )[0].id;
const events = async (ruleId: string) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM alert_events WHERE rule_id = $1", [ruleId]))[0].n;

describe("launchpad / smart-wallet alerts are not lost when events arrive late or in bursts", () => {
  it("fires for a launch recorded before the rule's last trigger (late LetsBonk resolution), exactly once", async () => {
    const id = await rule("dev_deploy", { min_dev_score: 60 });
    await db.query("UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1", [id]);
    await db.query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, dev_score_at_launch, dev_launches_at_launch)
       VALUES ('LateMint', 'bonk', 'DevA', now() - interval '10 minutes', 'stream', 75, 4)`,
    );
    await evaluateAlerts(["dev_deploy"]);
    expect(await events(id)).toBe(1);
    await evaluateAlerts(["dev_deploy"]);
    expect(await events(id)).toBe(1); // deduplicated
  });

  it("does not alert on single-launch devs, even with a high score", async () => {
    const id = await rule("dev_deploy", { min_dev_score: 60 });
    await db.query(
      `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, dev_score_at_launch, dev_launches_at_launch)
       VALUES ('OneShot', 'pump', 'DevB', now(), 'stream', 90, 1)`,
    );
    await evaluateAlerts(["dev_deploy"]);
    expect(await db.query("SELECT 1 FROM alert_events WHERE rule_id = $1 AND dedup_key = 'dev:OneShot'", [id])).toHaveLength(0);
  });

  it("delivers a burst larger than one batch over consecutive runs", async () => {
    const id = await rule("dev_deploy", { min_dev_score: 60 });
    for (let i = 0; i < 30; i++) {
      await db.query(
        `INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, dev_score_at_launch, dev_launches_at_launch)
         VALUES ($1, 'pump', 'DevC', now() - make_interval(secs => $2), 'stream', 80, 5)`,
        [`Burst${i}`, i],
      );
    }
    await evaluateAlerts(["dev_deploy"]);
    await evaluateAlerts(["dev_deploy"]);
    // 30 burst launches + the LateMint from the first test (all within the 2h window, rule created 1h ago).
    expect(await events(id)).toBe(31);
  });

  it("fires for a smart-wallet buy detected after the rule last fired", async () => {
    const id = await rule("smart_wallet_buy", { min_wallet_score: 60, min_buy_sol: 0.5 });
    await db.query("UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1", [id]);
    const [{ id: wallet }] = await db.query<{ id: string }>("INSERT INTO wallet_profiles (chain, address) VALUES ('solana', 'SmartW') RETURNING id");
    await db.query(
      `INSERT INTO wallet_scores (wallet_id, version, score, trades, decided_positions, open_positions, wins, losses, pnl_sol, early_entries, early_hits)
       VALUES ($1, 'v1', 70, 10, 8, 0, 6, 2, 5, 1, 1)`,
      [wallet],
    );
    await db.query(
      `INSERT INTO wallet_transactions (wallet_id, chain, tx_hash, block_time, direction, token_address, provider, raw)
       VALUES ($1, 'solana', 'sig1', now() - interval '12 minutes', 'buy', 'MintX', 'helius-rpc', '{"sol": 1.2}')`,
      [wallet],
    );
    await evaluateAlerts(["smart_wallet_buy"]);
    expect(await events(id)).toBe(1);
  });

  it("the regular cycle does not re-evaluate fast rules", async () => {
    const id = await rule("dev_deploy", { min_dev_score: 60 });
    await evaluateAlerts(); // regular cycle: fast rule types excluded
    expect(await events(id)).toBe(0);
  });
});

describe("followed wallet trades (wallet_activity)", () => {
  const tx = (wallet: string, sig: string, dir: string, ago: string, raw: object, token = "CoinA") =>
    db.query(
      `INSERT INTO wallet_transactions (wallet_id, chain, tx_hash, block_time, direction, token_address, token_symbol, amount, provider, raw)
       VALUES ($1, 'solana', $2, now() - $3::interval, $4, $5, 'COINA', 1000, 'helius-rpc', $6)`,
      [wallet, sig, ago, dir, token, JSON.stringify(raw)],
    );
  const titles = async (ruleId: string) =>
    (await db.query<{ title: string }>("SELECT n.title FROM notifications n JOIN alert_events e ON e.id = n.alert_event_id WHERE e.rule_id = $1 ORDER BY n.created_at, n.title", [ruleId])).map((r) => r.title);

  it("alerts every buy and sell of every followed wallet, whatever its score and with no scam check", async () => {
    const id = await rule("wallet_activity", { directions: ["buy", "sell", "transfer_out"], min_sol: 0.1 });
    const [{ id: followed }] = await db.query<{ id: string }>("INSERT INTO wallet_profiles (chain, address, label) VALUES ('solana', 'FollowedW1', 'Whale') RETURNING id");
    const [{ id: stranger }] = await db.query<{ id: string }>("INSERT INTO wallet_profiles (chain, address) VALUES ('solana', 'StrangerW1') RETURNING id");
    await db.query("INSERT INTO user_tracked_wallets (user_id, wallet_id, created_at) VALUES ($1, $2, now() - interval '30 minutes')", [user, followed]);

    await tx(followed, "old", "buy", "40 minutes", { sol: 1 }); // before the follow
    await tx(followed, "b1", "buy", "20 minutes", { sol: 1, priceUsdAtDetection: 0.001, mcapAtDetection: 1_000_000 });
    await tx(followed, "dust", "buy", "15 minutes", { sol: 0.01 }); // under min_sol
    await tx(followed, "s1", "sell", "10 minutes", { sol: 3, priceUsdAtDetection: 0.003 });
    await tx(followed, "s1", "transfer_out", "10 minutes", {}); // same tx as the sell, from the history sync
    await tx(followed, "air", "transfer_in", "5 minutes", {}); // not selected
    await tx(stranger, "x1", "buy", "5 minutes", { sol: 5 }); // not followed

    await evaluateAlerts(["wallet_activity"]);
    expect(await titles(id)).toEqual(["Whale bought COINA · 1 SOL", "Whale sold COINA · 3 SOL (+200.0%)"]);
    await evaluateAlerts(["wallet_activity"]);
    expect(await events(id)).toBe(2); // deduplicated
  });

  it("a single-wallet rule only covers that wallet", async () => {
    const [{ id: w2 }] = await db.query<{ id: string }>("INSERT INTO wallet_profiles (chain, address) VALUES ('solana', 'FollowedW2') RETURNING id");
    await db.query("INSERT INTO user_tracked_wallets (user_id, wallet_id, created_at) VALUES ($1, $2, now() - interval '30 minutes')", [user, w2]);
    const id = await rule("wallet_activity", {});
    await db.query("UPDATE alert_rules SET wallet_id = $2 WHERE id = $1", [id, w2]);
    await tx(w2, "w2buy", "buy", "3 minutes", { sol: 2 }, "CoinB");
    await evaluateAlerts(["wallet_activity"]);
    expect(await events(id)).toBe(1);
  });
});
