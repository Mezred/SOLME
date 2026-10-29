import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, setDbOverride, withUser, type Database } from "@/lib/db";

let db: Database;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
  setDbOverride(db);
  [{ id: alice }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('alice@test.dev') RETURNING id");
  [{ id: bob }] = await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('bob@test.dev') RETURNING id");
  await db.query("INSERT INTO watchlists (user_id, name) VALUES ($1, 'Alice list'), ($2, 'Bob list')", [alice, bob]);
});

afterAll(async () => {
  setDbOverride(undefined);
  await db.close();
});

describe("migrations", () => {
  it("seeds plans and settings", async () => {
    const plans = await db.query<{ id: string }>("SELECT id FROM subscription_plans ORDER BY sort_order");
    expect(plans.map((p) => p.id)).toEqual(["free", "pro", "elite"]);
    const settings = await db.query<{ key: string }>("SELECT key FROM app_settings ORDER BY key");
    expect(settings.map((s) => s.key)).toEqual(["ingestion", "scoring"]);
  });

  it("enforces unique token identity per chain + address", async () => {
    await db.query("INSERT INTO token_assets (chain, address, symbol, name) VALUES ('solana', 'MintA', 'A', 'A')");
    await expect(
      db.query("INSERT INTO token_assets (chain, address, symbol, name) VALUES ('solana', 'MintA', 'B', 'B')"),
    ).rejects.toThrow();
  });

  it("accepts Solana rows only", async () => {
    for (const table of ["token_assets", "launchpad_tokens", "wallet_profiles"]) {
      const sql =
        table === "token_assets"
          ? "INSERT INTO token_assets (chain, address, symbol, name) VALUES ('base', '0xabc', 'A', 'A')"
          : table === "launchpad_tokens"
            ? "INSERT INTO launchpad_tokens (mint, pool, creator, created_at, source, chain) VALUES ('0xabc', 'fourmeme', '0xdev', now(), 'stream', 'bsc')"
            : "INSERT INTO wallet_profiles (chain, address) VALUES ('ethereum', '0xabc')";
      await expect(db.query(sql), table).rejects.toThrow(/solana_only/);
    }
  });

  it("rejects wallet classifications without a documented source", async () => {
    await expect(
      db.query("INSERT INTO wallet_profiles (chain, address, classification) VALUES ('solana', 'X', 'whale')"),
    ).rejects.toThrow();
  });
});

describe("row-level security", () => {
  it("scopes reads to the current user", async () => {
    const rows = await withUser(alice, (tx) => tx.query<{ name: string }>("SELECT name FROM watchlists"));
    expect(rows.map((r) => r.name)).toEqual(["Alice list"]);
  });

  it("blocks writing rows owned by someone else", async () => {
    await expect(
      withUser(alice, (tx) => tx.query("INSERT INTO watchlists (user_id, name) VALUES ($1, 'sneaky')", [bob])),
    ).rejects.toThrow();
  });

  it("blocks updating another user's rows (silently matches zero rows)", async () => {
    const updated = await withUser(alice, (tx) =>
      tx.query("UPDATE watchlists SET name = 'pwned' WHERE user_id = $1 RETURNING id", [bob]),
    );
    expect(updated).toHaveLength(0);
    const [bobList] = await db.query<{ name: string }>("SELECT name FROM watchlists WHERE user_id = $1", [bob]);
    expect(bobList.name).toBe("Bob list");
  });

  it("denies access to tables the app role was never granted", async () => {
    await expect(withUser(alice, (tx) => tx.query("SELECT * FROM sessions"))).rejects.toThrow();
    await expect(withUser(alice, (tx) => tx.query("SELECT * FROM audit_logs"))).rejects.toThrow();
  });
});
