import type Anthropic from "@anthropic-ai/sdk";
import type { Entitlements } from "@/lib/billing/entitlements";
import { isUuid, query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { liveScore } from "@/lib/data/live-score";
import { getSignal, outcomeStats, signalStats } from "@/lib/data/signals";
import { getLatestSecurity, getToken, lastIngestion, searchTokens } from "@/lib/data/tokens";

/**
 * Data tools the model can call. Every result carries `as_of` timestamps and a `source`, and tools only
 * return what is stored or computed deterministically — the model has no other route to market data.
 */
export const AI_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_tokens",
    description: "Find tracked tokens by symbol, name or contract address. Returns token ids needed by other tools.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Symbol, name or address" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "get_token_report",
    description: "Latest market snapshot (price, % changes, volume, liquidity, market cap, transactions, pair age), deterministic score with every factor, risk flags, missing data and the latest security report for one token. Always call this before discussing a token.",
    input_schema: { type: "object", properties: { token_id: { type: "string" } }, required: ["token_id"], additionalProperties: false },
  },
  {
    name: "get_signal",
    description: "A stored signal with its factor breakdown, scenario levels and measured outcomes (if any). Use for explaining a specific signal.",
    input_schema: { type: "object", properties: { signal_id: { type: "string" } }, required: ["signal_id"], additionalProperties: false },
  },
  {
    name: "get_token_signals",
    description: "Recent signals for a token with measured 1h/6h/24h outcomes.",
    input_schema: { type: "object", properties: { token_id: { type: "string" } }, required: ["token_id"], additionalProperties: false },
  },
  {
    name: "get_market_overview",
    description: "Engine-wide context: active signal counts by type, native-asset 24h changes per chain, last ingestion time, and measured historical outcomes by signal type over the last N days.",
    input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
  },
  {
    name: "get_wallet_activity",
    description: "Recent recorded transactions for a wallet the user tracks (or a public documented wallet).",
    input_schema: { type: "object", properties: { wallet_id: { type: "string" } }, required: ["wallet_id"], additionalProperties: false },
  },
  {
    name: "list_my_watchlist",
    description: "Tokens on the user's watchlists (ids and symbols).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export interface ToolContext {
  userId: string;
  ent: Entitlements;
  sources: { type: string; id: string; label: string; as_of: string | null }[];
}

const round = (v: number | null | undefined, d = 6) => (v === null || v === undefined ? null : Number(v.toPrecision(d)));

async function tokenReport(id: string, ctx: ToolContext) {
  const t = await getToken(id);
  if (!t) return { error: "Token not found" };
  if (!ctx.ent.features.chains.includes(t.chain)) return { error: `The user's plan does not include ${t.chain}.` };
  const sec = await getLatestSecurity(id);
  const score = await liveScore(t, sec);
  ctx.sources.push({ type: "token", id, label: `${t.symbol} snapshot`, as_of: t.captured_at ? new Date(t.captured_at).toISOString() : null });
  return {
    token: { id: t.id, symbol: t.symbol, name: t.name, chain: t.chain, address: t.address, is_demo: t.is_demo, flagged_spam: t.is_spam ? t.spam_reason : null, promoted_listing: Boolean(t.metadata?.promoted) },
    snapshot: t.captured_at
      ? {
          as_of: new Date(t.captured_at).toISOString(),
          source: t.is_demo ? "DEMO (synthetic)" : "DexScreener via NEXALPHA ingestion",
          price_usd: round(t.price_usd),
          change_pct: { m5: t.price_change_m5, h1: t.price_change_h1, h6: t.price_change_h6, h24: t.price_change_h24, d7: "not provided by data source" },
          volume_usd: { h1: round(t.volume_h1, 4), h24: round(t.volume_h24, 4) },
          liquidity_usd: round(t.liquidity_usd, 4),
          market_cap_usd: round(t.market_cap, 4),
          fdv_usd: round(t.fdv, 4),
          txns_h1: { buys: t.buys_h1, sells: t.sells_h1 },
          txns_h24: { buys: t.buys_h24, sells: t.sells_h24 },
          pair_created_at: t.pair_created_at ? new Date(t.pair_created_at).toISOString() : null,
        }
      : "No snapshot available",
    deterministic_score: score
      ? {
          note: "Computed by NEXALPHA's rule-based engine from the snapshot above (no candle-based factors here).",
          ai_score: score.aiScore, quality: score.qualityScore, momentum: score.momentumScore, risk: score.riskScore, confidence: score.confidenceScore,
          pattern: score.signalType, strength: score.strength, stale: score.stale,
          factors: score.factors.map((f) => ({ key: f.key, score: f.score, weight: f.weight, reason: f.reason, missing: f.missing })),
          risk_flags: score.riskFlags, missing_data: score.missingData, eligible_as_signal: score.eligibility,
        }
      : null,
    security: sec
      ? { provider: sec.provider, checked_at: new Date(sec.checked_at).toISOString(), status: sec.status, risk_level: sec.risk_level, checks: sec.checks, unavailable_checks: sec.unavailable_checks, limitations: sec.limitations, holder_count: sec.holder_count, top10_holder_pct: sec.top10_holder_pct }
      : "No security report exists — treat as unverified, not clean.",
  };
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "search_tokens": {
      const q = String(input.query ?? "").slice(0, 80);
      if (q.length < 2) return { results: [] };
      return { results: await searchTokens(q, ctx.ent.features.chains, 8) };
    }
    case "get_token_report": {
      const id = String(input.token_id ?? "");
      if (!isUuid(id)) return { error: "token_id must be a UUID from search_tokens" };
      return tokenReport(id, ctx);
    }
    case "get_signal": {
      const id = String(input.signal_id ?? "");
      if (!isUuid(id)) return { error: "Invalid signal_id" };
      const s = await getSignal(id);
      if (!s || s.signal.is_demo !== env.demoMode) return { error: "Signal not found" };
      if (!ctx.ent.features.chains.includes(s.signal.chain)) return { error: "Signal chain not included in plan" };
      ctx.sources.push({ type: "signal", id, label: `${s.signal.symbol} ${s.signal.signal_type} signal`, as_of: new Date(s.signal.created_at).toISOString() });
      const { signal } = s;
      return {
        created_at: new Date(signal.created_at).toISOString(), symbol: signal.symbol, chain: signal.chain, type: signal.signal_type, strength: signal.strength,
        scores: { ai: signal.ai_score, quality: signal.quality_score, momentum: signal.momentum_score, risk: signal.risk_score, confidence: signal.confidence_score },
        price_at_signal: signal.price_at_signal, scenario: signal.entry_low !== null ? { entry_low: signal.entry_low, entry_high: signal.entry_high, invalidation: signal.invalidation, stop_loss: signal.stop_loss, take_profits: signal.take_profits } : null,
        rationale: signal.rationale, risk_flags: signal.risk_flags, missing_data: signal.missing_data, status: signal.status,
        factors: s.factors.map((f) => ({ key: f.factor_key, score: f.score, weight: f.weight, reason: f.reason, missing: f.missing, evidence: f.evidence })),
        measured_outcome: s.history ?? "not yet measured",
      };
    }
    case "get_token_signals": {
      const id = String(input.token_id ?? "");
      if (!isUuid(id)) return { error: "Invalid token_id" };
      const rows = await query(
        `SELECT s.id, s.created_at, s.signal_type, s.strength, s.ai_score, s.confidence_score, s.price_at_signal, s.status, h.return_1h, h.return_6h, h.return_24h, h.hit_take_profit, h.hit_invalidation
           FROM signals s LEFT JOIN signal_history h ON h.signal_id = s.id WHERE s.token_id = $1 AND s.chain = ANY($2) ORDER BY s.created_at DESC LIMIT 15`,
        [id, ctx.ent.features.chains],
      );
      return { signals: rows };
    }
    case "get_market_overview": {
      const days = Math.min(90, Math.max(1, Number(input.days ?? 7)));
      const [stats, ing, outcomes] = await Promise.all([signalStats(ctx.ent), lastIngestion(), outcomeStats(Math.min(days, ctx.ent.features.signal_history_days))]);
      ctx.sources.push({ type: "market", id: "overview", label: "Engine overview", as_of: ing?.value.finishedAt ?? null });
      return { as_of: ing?.value.finishedAt ?? null, active_signals: stats, native_asset_change_h24: ing?.value.regime ?? null, measured_outcomes_by_type: outcomes, demo_mode: env.demoMode };
    }
    case "get_wallet_activity": {
      const id = String(input.wallet_id ?? "");
      if (!isUuid(id)) return { error: "Invalid wallet_id" };
      const w = await queryOne<{ chain: string; address: string; label: string | null; classification: string; classification_source: string | null }>(
        `SELECT w.chain, w.address, COALESCE(t.custom_label, w.label) AS label, w.classification, w.classification_source FROM wallet_profiles w
          LEFT JOIN user_tracked_wallets t ON t.wallet_id = w.id AND t.user_id = $2 WHERE w.id = $1 AND (w.is_public OR t.user_id IS NOT NULL)`,
        [id, ctx.userId],
      );
      if (!w) return { error: "Wallet not found or not tracked by this user" };
      const txs = await query("SELECT block_time, direction, token_symbol, token_address, amount, tx_hash FROM wallet_transactions WHERE wallet_id = $1 ORDER BY block_time DESC LIMIT 40", [id]);
      ctx.sources.push({ type: "wallet", id, label: w.label ?? w.address.slice(0, 8), as_of: null });
      return { wallet: w, recorded_transactions: txs, note: "Directions are transfer-based; buy/sell only for detected swaps. No USD performance data is available." };
    }
    case "list_my_watchlist": {
      return {
        tokens: await query("SELECT t.id, t.symbol, t.chain FROM watchlist_items wi JOIN token_assets t ON t.id = wi.token_id WHERE wi.user_id = $1 LIMIT 50", [ctx.userId]),
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
