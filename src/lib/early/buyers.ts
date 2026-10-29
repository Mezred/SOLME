import { query } from "@/lib/db";
import { integrations } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { readTrading, recordBuyerStats } from "@/lib/tokens/investigate";
import { earlyFeed } from "./feed";
import { WALLETS_MAX_AGE_MINUTES } from "./signals";

const log = logger("early-buyers");

/** Coins sampled per run, best ranked first; each costs one page of pool history from Helius. */
const PER_RUN = 8;
/** Platform-wide cap on samples per hour (Helius credits). */
const PER_HOUR = 60;
/** A sample is refreshed once it is this old, a little before Early Coins stops using it. */
const REFRESH_MINUTES = WALLETS_MAX_AGE_MINUTES - 10;

/**
 * Counts unique buyers for the coins at the top of Early Coins from their latest ~100 pool trades: market data
 * providers report buy transactions only, which bots inflate. High Risk coins are skipped (no buyer count changes
 * that), as are coins sampled recently by this job or by a Coin Check.
 */
export async function sampleEarlyBuyers(): Promise<{ sampled: number }> {
  if (!integrations.helius) return { sampled: 0 };
  const feed = (await earlyFeed()).filter((c) => c.cls !== "high_risk" && c.pair);
  if (!feed.length) return { sampled: 0 };
  const fresh = new Set(
    (await query<{ address: string }>(
      "SELECT address FROM token_buyer_stats WHERE chain = 'solana' AND address = ANY($1) AND computed_at > now() - make_interval(mins => $2)",
      [feed.map((c) => c.address), REFRESH_MINUTES],
    )).map((r) => r.address),
  );
  let sampled = 0;
  for (const c of feed.filter((x) => !fresh.has(x.address)).slice(0, PER_RUN)) {
    if (!(await rateLimit("early-buyers:global", PER_HOUR, 3600)).allowed) break;
    try {
      const t = await readTrading(c.pair!, c.address, c.priceUsd);
      await recordBuyerStats("solana", c.address, t);
      sampled++;
    } catch (err) {
      log.warn("Buyer sample failed", { mint: c.address, error: errorMessage(err) });
    }
  }
  return { sampled };
}
