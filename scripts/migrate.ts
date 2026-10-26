// Applies pending migrations to DATABASE_URL (or the local PGlite directory).
import { getDb } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";

async function main() {
  const db = await getDb(); // getDb() migrates on first use
  const ran = await migrate(db);
  const rows = await db.query<{ name: string; applied_at: Date }>("SELECT name, applied_at FROM schema_migrations ORDER BY name");
  console.log(`Driver: ${db.driver}. Newly applied: ${ran.length ? ran.join(", ") : "none"}.`);
  console.table(rows);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
