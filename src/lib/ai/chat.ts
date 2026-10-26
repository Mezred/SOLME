import Anthropic from "@anthropic-ai/sdk";
import type { Entitlements } from "@/lib/billing/entitlements";
import { query, queryOne, withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, upgradeRequired } from "@/lib/http";
import { errorMessage, logger } from "@/lib/log";
import { AI_TOOLS, runTool, type ToolContext } from "./tools";

const log = logger("ai");

const SYSTEM = `You are NEXALPHA's research assistant for on-chain DEX tokens on Solana, Ethereum, BNB Smart Chain and Base.

Ground rules:
- Use only data returned by your tools. Never state a price, volume, holder count, wallet label, security result or historical performance that a tool did not return. If you need data, call a tool; if the tool has no data, say it is unavailable.
- Cite the "as_of" timestamp of every market figure you mention, and the provider for security findings.
- Scores come from NEXALPHA's deterministic engine. Explain them from their factors and evidence; never invent or adjust a score.
- A missing security result means "unverified", never "safe".
- Be explicit about uncertainty and what the data cannot tell (e.g. transaction counts are not trade sizes).
- Do not predict future prices, promise returns, or tell the user to buy or sell. You may describe scenarios, risks and what would invalidate a thesis.
- If any returned data is marked DEMO, state clearly that it is synthetic demonstration data.
- Be concise and structured. Use short headings and bullet points for reports.`;

let client: Anthropic | null = null;
function getClient() {
  if (!env.anthropicApiKey) throw new ApiError(503, "AI is not configured on this server (ANTHROPIC_API_KEY missing).", "ai_unconfigured");
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

/** Daily usage counts only completed assistant replies. */
export async function aiUsageToday(userId: string) {
  const r = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM ai_messages WHERE user_id = $1 AND role = 'assistant' AND created_at > now() - interval '24 hours'",
    [userId],
  );
  return r?.n ?? 0;
}

export interface ChatResult {
  conversationId: string;
  reply: string;
  sources: ToolContext["sources"];
  usage: { input: number; output: number; costUsd: number };
  model: string;
}

export async function runChat(opts: { userId: string; ent: Entitlements; conversationId?: string; message: string; kind: "chat" | "analysis" }): Promise<ChatResult> {
  const { userId, ent } = opts;
  if (opts.kind === "analysis" && !ent.features.ai_deep_analysis) throw upgradeRequired("Deep AI analysis requires Pro or Elite.");
  const used = await aiUsageToday(userId);
  if (used >= ent.features.ai_daily_requests) throw new ApiError(429, `Daily AI limit reached (${ent.features.ai_daily_requests} on ${ent.planName}). Resets on a rolling 24h window.`, "ai_quota");
  const anthropic = getClient();

  // Conversation (RLS-scoped) and prior turns as plain text.
  const conversationId = await withUser(userId, async (tx) => {
    if (opts.conversationId) {
      const [c] = await tx.query<{ id: string }>("SELECT id FROM ai_conversations WHERE id = $1", [opts.conversationId]);
      if (!c) throw new ApiError(404, "Conversation not found", "not_found");
      return c.id;
    }
    const [c] = await tx.query<{ id: string }>("INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id", [userId, opts.message.slice(0, 80)]);
    return c.id;
  });
  const history = await withUser(userId, (tx) =>
    tx.query<{ role: "user" | "assistant"; content: string }>(
      "SELECT role, content FROM (SELECT role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12) h ORDER BY created_at",
      [conversationId],
    ),
  );

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: `[Current time: ${new Date().toISOString()} · user plan chains: ${ent.features.chains.join(", ")}${env.demoMode ? " · DEMO MODE active" : ""}]\n\n${opts.message}` },
  ];
  const ctx: ToolContext = { userId, ent, sources: [] };
  const trace: { tool: string; input: unknown; ok: boolean }[] = [];
  let input = 0;
  let output = 0;
  let reply = "";
  let model = env.aiModel;

  try {
    for (let i = 0; i < 6; i++) {
      const res = await anthropic.beta.messages.create({
        model: env.aiModel,
        max_tokens: 16000,
        system: SYSTEM,
        tools: AI_TOOLS,
        messages,
        output_config: { effort: opts.kind === "analysis" ? "high" : env.aiEffort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      input += res.usage.input_tokens;
      output += res.usage.output_tokens;
      model = res.model;
      if (res.stop_reason === "refusal") {
        reply = "I can't help with that request. I can explain token data, signals, security findings and wallet activity.";
        break;
      }
      messages.push({ role: "assistant", content: res.content });
      const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        reply = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        if (res.stop_reason === "max_tokens") reply += "\n\n_(Response truncated.)_";
        break;
      }
      // Execute all tool calls and return every result in one user message.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const out = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx);
          trace.push({ tool: tu.name, input: tu.input, ok: true });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60_000) });
        } catch (err) {
          trace.push({ tool: tu.name, input: tu.input, ok: false });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `Tool error: ${errorMessage(err)}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, "The AI provider is rate-limiting requests. Try again shortly.", "ai_rate_limited");
    if (err instanceof Anthropic.AuthenticationError) throw new ApiError(503, "AI provider authentication failed — check ANTHROPIC_API_KEY.", "ai_unconfigured");
    if (err instanceof Anthropic.APIError) {
      log.error("Anthropic API error", { status: err.status, error: err.message });
      throw new ApiError(502, "The AI provider returned an error. Please retry.", "ai_upstream");
    }
    log.error("AI chat failed", { error: errorMessage(err) });
    throw new ApiError(502, "AI request failed. Please retry.", "ai_upstream");
  }
  if (!reply) reply = "I wasn't able to complete that analysis within the tool-call budget. Try a more specific question.";

  const costUsd = (input * env.aiInputPricePerMTok + output * env.aiOutputPricePerMTok) / 1_000_000;
  await withUser(userId, async (tx) => {
    await tx.query("INSERT INTO ai_messages (conversation_id, user_id, role, content, kind) VALUES ($1, $2, 'user', $3, $4)", [conversationId, userId, opts.message, opts.kind]);
    await tx.query(
      `INSERT INTO ai_messages (conversation_id, user_id, role, content, kind, sources, tool_trace, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [conversationId, userId, reply, opts.kind, JSON.stringify(ctx.sources), JSON.stringify(trace), model, input, output, costUsd],
    );
    await tx.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
  });
  return { conversationId, reply, sources: ctx.sources, usage: { input, output, costUsd }, model };
}

export async function aiCostSummary(days = 30) {
  return query<{ day: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number; users: number }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS requests, sum(input_tokens)::int AS input_tokens,
            sum(output_tokens)::int AS output_tokens, COALESCE(sum(cost_usd), 0) AS cost_usd, count(DISTINCT user_id)::int AS users
       FROM ai_messages WHERE role = 'assistant' AND created_at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 1 DESC`,
    [days],
  );
}
