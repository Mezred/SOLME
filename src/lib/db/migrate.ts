import type { Database } from "./index";
import { MIGRATIONS } from "./migrations.generated";

/**
 * Applies pending SQL migrations in order, each in its own transaction.
 * Migration SQL is embedded at build time (scripts/embed-migrations.ts) so it works in serverless bundles.
 */
export async function migrate(db: Database): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name),
  );
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    if (db.driver === "pglite") {
      // PGlite's exec runs multi-statement scripts; wrap manually for atomicity.
      await db.exec(`BEGIN;\n${m.sql}\n;INSERT INTO schema_migrations (name) VALUES ('${m.name}');\nCOMMIT;`).catch(
        async (err) => {
          await db.exec("ROLLBACK").catch(() => {});
          throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
        },
      );
    } else {
      await db.transaction(async (tx) => {
        await tx.query(m.sql);
        await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
      });
    }
    ran.push(m.name);
  }
  return ran;
}
