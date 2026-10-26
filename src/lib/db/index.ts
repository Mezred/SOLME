import { env } from "@/lib/env";

/**
 * Minimal SQL access layer over two interchangeable drivers:
 *  - node-postgres (`pg`) when DATABASE_URL is set (production, staging)
 *  - PGlite (embedded Postgres 17 in WASM) for local development and tests
 * Both run the same SQL migrations, including row-level security.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  driver: "pg" | "pglite";
}

// numeric -> number, int8 -> number. Amounts we store are well within float64 precision for display;
// money that needs exactness (billing) is stored as integer cents.
const NUMERIC_OID = 1700;
const INT8_OID = 20;
const parseNumeric = (v: string) => (v === null ? null : Number(v));

async function createPg(url: string): Promise<Database> {
  const pg = await import("pg");
  const Pool = pg.default?.Pool ?? pg.Pool;
  const types = pg.default?.types ?? pg.types;
  types.setTypeParser(NUMERIC_OID, parseNumeric);
  types.setTypeParser(INT8_OID, parseNumeric);
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: /sslmode=require|neon\.tech|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    driver: "pg",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = params.length ? await pool.query(sql, params as unknown[]) : await pool.query(sql);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            // Without parameters use the simple protocol so multi-statement migrations work.
            const res = params.length ? await client.query(sql, params as unknown[]) : await client.query(sql);
            return res.rows as R[];
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPglite(dataDir: string | undefined): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const fs = await import("node:fs");
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const parsers = { [NUMERIC_OID]: parseNumeric, [INT8_OID]: parseNumeric };
  const db = dataDir ? await PGlite.create(dataDir, { parsers }) : await PGlite.create({ parsers });
  return {
    driver: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await db.query<T>(sql, params as unknown[]);
      return res.rows;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return db.transaction(async (tx) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await tx.query<R>(sql, params as unknown[]);
            return res.rows;
          },
        }),
      );
    },
    async close() {
      await db.close();
    },
  };
}

type GlobalDb = { __nexalphaDb?: Promise<Database>; __nexalphaDbOverride?: Database };
const g = globalThis as unknown as GlobalDb;

/** Returns the process-wide database (migrated). Survives Next.js dev hot reloads. */
export function getDb(): Promise<Database> {
  if (g.__nexalphaDbOverride) return Promise.resolve(g.__nexalphaDbOverride);
  if (!g.__nexalphaDb) {
    g.__nexalphaDb = (async () => {
      const db = env.databaseUrl ? await createPg(env.databaseUrl) : await createPglite(env.pgliteDir);
      const { migrate } = await import("./migrate");
      await migrate(db);
      return db;
    })().catch((err) => {
      g.__nexalphaDb = undefined;
      throw err;
    });
  }
  return g.__nexalphaDb;
}

/** Tests: use an isolated in-memory database. */
export async function createTestDb(): Promise<Database> {
  const db = await createPglite(undefined);
  const { migrate } = await import("./migrate");
  await migrate(db);
  return db;
}

export function setDbOverride(db: Database | undefined) {
  g.__nexalphaDbOverride = db;
}

export async function query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await getDb()).query<T>(sql, params);
}

export async function queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return (await getDb()).transaction(fn);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Runs `fn` as the restricted `nexalpha_app` role with app.user_id set, so row-level security
 * policies scope every statement to this user. Use for all user-owned data access.
 */
export async function withUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) throw new Error("withUser: invalid user id");
  return transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE nexalpha_app");
    await tx.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return fn(tx);
  });
}
