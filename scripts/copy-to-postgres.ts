// Copies all data from the embedded PGlite database to Postgres (the move off PGlite before going live).
// Stop `npm run dev` first: PGlite can only be opened by one process.
// Usage: npm run db:copy-to-postgres -- postgres://user:pass@host:5432/db [--force]
import { copyDatabase } from "@/lib/db/copy";
import { openDatabaseAt } from "@/lib/db";
import { env } from "@/lib/env";

async function main() {
  const url = process.argv.find((a) => /^postgres(ql)?:\/\//.test(a));
  if (!url) throw new Error("Pass the target Postgres URL, e.g. npm run db:copy-to-postgres -- postgres://user:pass@host:5432/db");
  const force = process.argv.includes("--force");
  console.log(`Source: PGlite at ${env.pgliteDir}`);
  const src = await openDatabaseAt({ pgliteDir: env.pgliteDir });
  console.log(`Target: ${url.replace(/\/\/[^@]*@/, "//***@")} (migrating first)`);
  const dst = await openDatabaseAt({ url });
  const results = await copyDatabase(src, dst, { force, log: (l) => console.log(`  ${l}`) });
  console.log(`Done: ${results.reduce((s, r) => s + r.rows, 0)} rows in ${results.length} tables.`);
  console.log("Next: set DATABASE_URL to this database in .env.local, set WORKER_IN_PROCESS=false, and run `npm run worker` next to the web app.");
  await Promise.all([src.close(), dst.close()]);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
