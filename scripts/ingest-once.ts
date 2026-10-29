// Runs a single ingestion cycle (or the demo seed with DEMO_MODE=true) and prints a summary.
// Usage: npx tsx scripts/ingest-once.ts
import { getDb, query } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureDemoData } from "@/lib/demo/seed";
import { runIngestionCycle } from "@/lib/ingestion/pipeline";
import { flushProviderHealth } from "@/lib/providers/health";

async function main() {
  await getDb();
  if (env.demoMode) {
    await ensureDemoData(true);
    console.log("Demo data refreshed.");
  } else {
    const stats = await runIngestionCycle();
    console.log(JSON.stringify(stats, null, 2));
  }
  await flushProviderHealth();
  const top = await query(
    `SELECT chain, symbol, metadata->'last_score'->>'type' AS pattern, metadata->'last_score'->>'ai' AS ai_score,
            metadata->'last_score'->>'eligible' AS eligible
       FROM token_assets WHERE metadata ? 'last_score' ORDER BY metadata->'last_score'->>'at' DESC LIMIT 12`,
  );
  console.table(top);
  console.table(await query("SELECT provider, status, success_count, error_count, last_error FROM api_provider_status"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
