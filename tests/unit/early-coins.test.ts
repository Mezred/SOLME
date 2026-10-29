import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { recordRisk } from "@/lib/alerts/watch-checks";
import { createTestDb, setDbOverride, type Database } from "@/lib/db";
import { earlyFeed, resetEarlyFeedCache } from "@/lib/early/feed";
import { classifyEarly, type EarlyFacts } from "@/lib/early/signals";

// A fresh coin, active but not special: volume and transactions at their usual pace, contract checked.
const base: EarlyFacts = {
  priceUsd: 0.001,
  change: { m5: 1, h1: 2, h6: 10 },
  volume: { h1: 10_000, h6: 60_000 },
  txns: { buysH1: 60, sellsH1: 60, buysH6: 360, sellsH6: 360 },
  liquidityUsd: 40_000,
  liquidityPeakUsd: 41_000,
  marketCapUsd: 300_000,
  ageHours: 5,
  contractRisk: "low",
  launchCheckPassed: null,
  devScore: null,
  devLaunches: null,
  devSoldPct: null,
  smartWallets: 0,
  smartSol: 0,
  dataAgeMinutes: 3,
  onchainData: true,
};
const busy = { volume: { h1: 40_000, h6: 60_000 }, txns: { buysH1: 300, sellsH1: 150, buysH6: 600, sellsH6: 600 } };

describe("Early Coins classification", () => {
  it("leaves out coins with no signal, stale data, thin pools or over 3 days old", () => {
    expect(classifyEarly(base).cls).toBeNull();
    expect(classifyEarly({ ...base, ...busy, dataAgeMinutes: 45 }).cls).toBeNull();
    expect(classifyEarly({ ...base, ...busy, liquidityUsd: 3_000 }).cls).toBeNull();
    expect(classifyEarly({ ...base, ...busy, ageHours: 80 }).cls).toBeNull();
  });

  it("is Early Activity when activity rises against the coin's own pace, with the reasons", () => {
    const r = classifyEarly({ ...base, ...busy, liquidityUsd: 20_000, liquidityPeakUsd: 20_000 });
    expect(r.cls).toBe("early");
    expect(r.signals.map((s) => s.key)).toEqual(["volume", "txns", "buyers"]);
    expect(r.why).toBe("Volume 4.0× its 6h pace ($40k in 1h) · Transactions 2.3× their 6h pace (450 in 1h)");
    expect(r.check).toBe("ok");
  });

  it("is Building Momentum only with both activity and quality signals", () => {
    const r = classifyEarly({ ...base, ...busy, smartWallets: 2, smartSol: 6 });
    expect(r.cls).toBe("building");
    expect(r.signals[0].text).toBe("2 smart wallets bought (6.0 SOL)");
    // Quality alone (no rising activity) is not in the feed.
    expect(classifyEarly({ ...base, smartWallets: 3, devScore: 80 }).cls).toBeNull();
  });

  it("never ranks by price alone", () => {
    expect(classifyEarly({ ...base, change: { m5: 5, h1: 80, h6: 120 } }).cls).toBeNull();
  });

  it("flags critical findings as High Risk instead of ranking them", () => {
    const r = classifyEarly({ ...base, ...busy, smartWallets: 2, contractRisk: "critical" });
    expect(r.cls).toBe("high_risk");
    expect(r.why).toMatch(/^Contract check: critical risk, despite 2 smart wallets bought/);
    expect(classifyEarly({ ...base, ...busy, liquidityPeakUsd: 80_000 }).flags.find((f) => f.key === "liquidity")?.text).toBe("Liquidity down 50% in 2h");
    expect(classifyEarly({ ...base, ...busy, launchCheckPassed: false }).cls).toBe("high_risk");
    expect(classifyEarly({ ...base, ...busy, devSoldPct: 8 }).cls).toBe("high_risk");
  });

  it("says what is missing instead of guessing", () => {
    const r = classifyEarly({ ...base, ...busy, contractRisk: null, onchainData: false });
    expect(r.check).toBe("unchecked");
    expect(r.missing).toEqual(["smart-wallet and launch data (no Helius key)", "contract check"]);
  });
});

describe("Early Coins feed and alerts", () => {
  let db: Database;
  let user: string;
  const coin = async (symbol: string, o: { ageH: number; volH1: number; volH6: number; buysH1: number; sellsH1: number; liq: number; risk?: string | null; snapAgoMin?: number }) => {
    const [{ id }] = await db.query<{ id: string }>(
      `INSERT INTO token_assets (chain, address, symbol, name, pair_created_at) VALUES ('solana', $1, $2, $2, now() - make_interval(hours => $3)) RETURNING id`,
      [`${symbol}Mint1111111111111111111111111111`.slice(0, 40), symbol, o.ageH],
    );
    await db.query(
      `INSERT INTO market_snapshots (token_id, source, price_usd, price_change_m5, price_change_h1, price_change_h6, volume_h1, volume_h6, buys_h1, sells_h1, buys_h6, sells_h6, liquidity_usd, market_cap, captured_at)
       VALUES ($1, 'test', 0.001, 1, 10, 20, $2, $3, $4, $5, 600, 600, $6, 400000, now() - make_interval(mins => $7))`,
      [id, o.volH1, o.volH6, o.buysH1, o.sellsH1, o.liq, o.snapAgoMin ?? 2],
    );
    if (o.risk !== null) await db.query("INSERT INTO token_security_checks (token_id, provider, status, risk_level) VALUES ($1, 'test', 'complete', $2)", [id, o.risk ?? "low"]);
    return id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    setDbOverride(db);
    [{ id: user }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('early@test.dev') RETURNING id");
    await coin("BUSY", { ageH: 4, volH1: 40_000, volH6: 60_000, buysH1: 300, sellsH1: 150, liq: 50_000 });
    await coin("QUIET", { ageH: 4, volH1: 10_000, volH6: 60_000, buysH1: 100, sellsH1: 100, liq: 50_000 });
    await coin("STALE", { ageH: 4, volH1: 40_000, volH6: 60_000, buysH1: 300, sellsH1: 150, liq: 50_000, snapAgoMin: 90 });
    await coin("RUGGY", { ageH: 4, volH1: 40_000, volH6: 60_000, buysH1: 300, sellsH1: 150, liq: 50_000, risk: "critical" });
  });
  afterAll(async () => {
    setDbOverride(undefined);
    await db.close();
  });

  it("lists active fresh coins with current data, risky ones last", async () => {
    resetEarlyFeedCache();
    const feed = await earlyFeed();
    expect(feed.map((c) => [c.symbol, c.cls])).toEqual([["BUSY", "early"], ["RUGGY", "high_risk"]]);
  });

  it("an Early Coins alert stays quiet about what is already listed, then fires once per new coin", async () => {
    const [{ id: rule }] = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'early', 'early_coin', '{"min_class":"early"}', '{in_app}') RETURNING id`,
      [user],
    );
    const sent = async () => (await db.query<{ title: string }>("SELECT n.title FROM notifications n JOIN alert_events e ON e.id = n.alert_event_id WHERE e.rule_id = $1", [rule])).map((r) => r.title);
    resetEarlyFeedCache();
    await evaluateAlerts();
    expect(await sent()).toEqual([]); // primed silently: BUSY was already there

    await coin("NEWBIE", { ageH: 1, volH1: 30_000, volH6: 40_000, buysH1: 250, sellsH1: 100, liq: 40_000 });
    resetEarlyFeedCache();
    await evaluateAlerts();
    await evaluateAlerts();
    expect(await sent()).toEqual(["NEWBIE: Early Activity"]); // never the High Risk coin, never twice
  });

  it("a watchlist alert fires when a watched coin's liquidity drops fast", async () => {
    const id = await coin("WATCHED", { ageH: 30, volH1: 1_000, volH6: 6_000, buysH1: 10, sellsH1: 10, liq: 20_000 });
    await db.query("INSERT INTO market_snapshots (token_id, source, price_usd, liquidity_usd, captured_at) VALUES ($1, 'test', 0.001, 60000, now() - interval '70 minutes')", [id]);
    const [{ id: list }] = await db.query<{ id: string }>("INSERT INTO watchlists (user_id, name) VALUES ($1, 'Main') RETURNING id", [user]);
    await db.query("INSERT INTO watchlist_items (watchlist_id, user_id, token_id) VALUES ($1, $2, $3)", [list, user, id]);
    const [{ id: rule }] = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'wl', 'watchlist_risk', '{"liquidity_drop_pct":30}', '{in_app}') RETURNING id`,
      [user],
    );
    await evaluateAlerts();
    const titles = (await db.query<{ title: string }>("SELECT n.title FROM notifications n JOIN alert_events e ON e.id = n.alert_event_id WHERE e.rule_id = $1", [rule])).map((r) => r.title);
    expect(titles).toEqual(["WATCHED: liquidity down 67% in ~1h"]);

    // The background full risk check: the first result is the baseline, a rise to High alerts once.
    const findings = [{ label: "Insiders", detail: "4 wallets share a funder, 31%", status: "fail" }];
    await recordRisk(id, "moderate", findings);
    await evaluateAlerts();
    await recordRisk(id, "high", findings);
    await evaluateAlerts();
    await evaluateAlerts();
    const after = (await db.query<{ title: string }>("SELECT n.title FROM notifications n JOIN alert_events e ON e.id = n.alert_event_id WHERE e.rule_id = $1 ORDER BY n.created_at", [rule])).map((r) => r.title);
    expect(after).toEqual(["WATCHED: liquidity down 67% in ~1h", "WATCHED: risk now High"]);
  });

  it("an Early Coins alert respects its smart-wallet minimum and hourly limit", async () => {
    const [{ id: rule }] = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'capped', 'early_coin', '{"min_class":"early","max_per_hour":1}', '{in_app}') RETURNING id`,
      [user],
    );
    const [{ id: picky }] = await db.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, params, channels) VALUES ($1, 'smart', 'early_coin', '{"min_class":"early","min_smart_wallets":2}', '{in_app}') RETURNING id`,
      [user],
    );
    const sent = async (r: string) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications n JOIN alert_events e ON e.id = n.alert_event_id WHERE e.rule_id = $1", [r]))[0].n;
    resetEarlyFeedCache();
    await evaluateAlerts(); // prime both
    await coin("FIRST", { ageH: 1, volH1: 30_000, volH6: 40_000, buysH1: 250, sellsH1: 100, liq: 40_000 });
    await coin("SECOND", { ageH: 1, volH1: 30_000, volH6: 40_000, buysH1: 250, sellsH1: 100, liq: 40_000 });
    resetEarlyFeedCache();
    await evaluateAlerts();
    await evaluateAlerts();
    expect(await sent(rule)).toBe(1); // the second waits for the next hour
    expect(await sent(picky)).toBe(0); // no smart wallets bought these
  });
});
