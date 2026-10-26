import { z } from "zod";
import { getEntitlements, assertChain } from "@/lib/billing/entitlements";
import { isChainId } from "@/lib/chains";
import { isUuid, queryOne } from "@/lib/db";
import { demoCandles } from "@/lib/demo/seed";
import { getSnapshotSeries } from "@/lib/data/tokens";
import { api, badRequest, enforceRateLimit, notFound, ok, parseQuery, requireUser } from "@/lib/http";
import { geckoterminal } from "@/lib/providers/geckoterminal";
import { errorMessage } from "@/lib/log";

const schema = z.object({ tf: z.enum(["15m", "1h", "4h", "1d"]).default("15m") });

/** OHLCV for the token's primary pair. Falls back to our own snapshot series (labelled) if the provider fails. */
export const GET = api<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const user = await requireUser();
  await enforceRateLimit(`candles:${user.id}`, 60, 60);
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("Invalid token id");
  const { tf } = parseQuery(req, schema);
  const token = await queryOne<{ chain: string; address: string; is_demo: boolean; pair_address: string | null; price_usd: number | null }>(
    `SELECT t.chain, t.address, t.is_demo, p.pair_address,
            (SELECT price_usd FROM market_snapshots s WHERE s.token_id = t.id ORDER BY captured_at DESC LIMIT 1) AS price_usd
       FROM token_assets t LEFT JOIN market_pairs p ON p.token_id = t.id AND p.is_primary WHERE t.id = $1`,
    [id],
  );
  if (!token || !isChainId(token.chain)) throw notFound("Token not found");
  assertChain(await getEntitlements(user.id), token.chain);

  if (token.is_demo) {
    const step = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 }[tf];
    return ok({ source: "demo", demo: true, candles: demoCandles(token.address, token.price_usd ?? 1, 96, step) });
  }
  if (token.pair_address) {
    try {
      const candles = await geckoterminal.getCandles(token.chain, token.pair_address, tf, 200);
      if (candles.length) return ok({ source: "geckoterminal", demo: false, candles });
    } catch (err) {
      const series = await getSnapshotSeries(id, 48);
      return ok({ source: "snapshots", demo: false, degraded: errorMessage(err), line: series.filter((s) => s.price !== null).map((s) => ({ time: Math.floor(new Date(s.t).getTime() / 1000), value: s.price })) });
    }
  }
  const series = await getSnapshotSeries(id, 48);
  return ok({ source: "snapshots", demo: false, line: series.filter((s) => s.price !== null).map((s) => ({ time: Math.floor(new Date(s.t).getTime() / 1000), value: s.price })) });
});
