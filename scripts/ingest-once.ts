// Runs a single ingestion cycle (or the demo seed with DEMO_MODE=true) and prints a summary.
// Usage: npx tsx scripts/ingest-once.ts
import { getDb, query } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureDemoData } from "@/lib/demo/seed";
import { runIngestionCycle, trackSignalOutcomes } from "@/lib/ingestion/pipeline";
import { flushProviderHealth } from "@/lib/providers/health";

async function main() {
  await getDb();
  if (env.demoMode) {
    await ensureDemoData(true);
    console.log("Demo data refreshed.");
  } else {
    const stats = await runIngestionCycle();
    console.log(JSON.stringify(stats, null, 2));
    await trackSignalOutcomes();
  }
  await flushProviderHealth();
  const top = await query(
    `SELECT t.chain, t.symbol, s.signal_type, s.strength, s.ai_score, s.confidence_score, s.risk_score, s.rationale
       FROM signals s JOIN token_assets t ON t.id = s.token_id ORDER BY s.created_at DESC LIMIT 12`,
  );
  console.table(top);
  console.table(await query("SELECT provider, status, success_count, error_count, last_error FROM api_provider_status"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
