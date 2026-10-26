// Standalone background worker for production deployments with Postgres.
// Usage: npm run worker   (runs scheduler ticks every WORKER_INTERVAL_MS, default 15s)
import { getDb } from "@/lib/db";
import { tick } from "@/lib/jobs/scheduler";

const interval = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
let stopping = false;

async function main() {
  const db = await getDb();
  console.log(JSON.stringify({ level: "info", source: "worker", message: "Worker started", driver: db.driver, interval }));
  while (!stopping) {
    const started = Date.now();
    const { processed } = await tick();
    if (processed) console.log(JSON.stringify({ level: "info", source: "worker", message: "Tick", processed, ms: Date.now() - started }));
    await new Promise((r) => setTimeout(r, Math.max(1000, interval - (Date.now() - started))));
  }
  await db.close();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    console.log(JSON.stringify({ level: "info", source: "worker", message: `Received ${sig}, finishing current tick` }));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
