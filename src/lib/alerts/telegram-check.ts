import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, normalizeAddress, type ChainId } from "@/lib/chains";
import { queryOne } from "@/lib/db";
import { checkToken } from "@/lib/decision/check-token";
import { sectionSummary, type Decision, type GateStatus } from "@/lib/decision/verdict";
import { env } from "@/lib/env";
import { lookupAddress } from "@/lib/ingestion/lookup";
import { rateLimit } from "@/lib/ratelimit";
import { formatTelegramAlert, type AlertCard, type TelegramMessage } from "./telegram-format";

/** Per linked chat: each full check costs ~15 Helius credits (holders) plus provider calls. */
export const TG_CHECK_LIMIT = { count: 10, windowSeconds: 300 };
/** The same coin asked again within this window gets the stored answer instead of a new check. */
const CACHE_MS = 2 * 60_000;

/** First contract address in a message: a bare address or one inside a link (pump.fun/coin/<mint>, explorer URLs…). */
export function extractAddress(text: string): string | null {
  const m = text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])|(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/);
  return m ? m[0] : null;
}

const VERDICT: Record<Decision["verdict"], { icon: string; label: string }> = {
  tradeable: { icon: "✅", label: "Tradeable" },
  candidate: { icon: "🟢", label: "Candidate" },
  watch: { icon: "👀", label: "Watch" },
  avoid: { icon: "⛔", label: "Avoid" },
};
const GATE_ICON: Record<GateStatus, string> = { pass: "✅", warn: "⚠️", fail: "❌", unknown: "❔" };
const TIMING: Record<Decision["timing"], string> = { early: "early", "mid-move": "mid-move, size down", overextended: "vertical, don't chase", dumping: "dumping, wait", unknown: "unknown" };

/** The check as a Telegram card: verdict, one line per question (worst finding first), reasons to buy, timing. */
export function checkCard(d: Decision, coin: { symbol: string; chain: ChainId; address: string; pool: string | null }): AlertCard {
  const v = VERDICT[d.verdict];
  const facts: [string, string][] = d.sections.map((s) => [s.question, `${GATE_ICON[s.status]} ${sectionSummary(s)}`]);
  facts.push(["Reasons to buy", d.edges.length ? d.edges.join(", ") : "none yet"]);
  facts.push(["Timing", TIMING[d.timing]]);
  facts.push(["Safety", `${d.safetyScore}/100`]);
  return {
    icon: v.icon,
    headline: `Check: ${v.label}`,
    symbol: coin.symbol,
    chain: coin.chain,
    pool: coin.pool,
    address: coin.address,
    facts,
    note: `${d.headline}${d.fullCheck ? "" : " · Holder check unavailable right now."} Research, not advice.`,
  };
}

const cache = new Map<string, { at: number; card: AlertCard; link: string }>();

const text = (t: string): TelegramMessage => ({ text: t, buttons: [] });

/**
 * Reply to a contract address sent to the bot by a linked user: the same pre-buy check as Check a coin, on the
 * chains of the user's plan. Null when the message holds no address (the caller answers with help instead).
 */
export async function telegramCheckReply(userId: string, message: string): Promise<TelegramMessage | null> {
  const raw = extractAddress(message);
  if (!raw) return null;
  const ent = await getEntitlements(userId);
  if (raw.startsWith("0x")) return text("SOLME covers Solana only. Send a Solana contract (or a pump.fun link).");
  const chains = ent.features.chains;

  // A coin we already track: its chain is known. Otherwise ask the providers on each chain of the plan.
  let chain = (
    await queryOne<{ chain: ChainId }>(
      "SELECT chain FROM token_assets WHERE address = ANY($1) AND chain = ANY($2) ORDER BY (metadata ? 'last_score') DESC LIMIT 1",
      [[raw, raw.toLowerCase()], chains],
    )
  )?.chain;
  const cached = chain ? cache.get(`${chain}:${normalizeAddress(chain, raw)}`) : undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return formatTelegramAlert(cached.card, `${env.appUrl}${cached.link}`);

  const limit = await rateLimit(`tgcheck:${userId}`, TG_CHECK_LIMIT.count, TG_CHECK_LIMIT.windowSeconds);
  if (!limit.allowed) {
    const mins = Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 60_000));
    return text(`⏱ ${TG_CHECK_LIMIT.count} checks per ${TG_CHECK_LIMIT.windowSeconds / 60} minutes. Try again in ${mins} min.`);
  }
  if (!chain) chain = (await lookupAddress(raw, chains, { explicit: true }))[0]?.chain;
  const address = chain ? normalizeAddress(chain, raw) : null;
  const result = chain && address ? await checkToken(chain, address, { explicit: true, budgetUserId: userId }) : null;
  if (!chain || !address || !result) {
    return text(`No DEX market found for <code>${raw}</code> on ${chains.map((c) => CHAINS[c].name).join(", ")}. Brand-new launches can take a minute to appear: send it again shortly.`);
  }

  const pool = (await queryOne<{ pool: string }>("SELECT pool FROM launchpad_tokens WHERE mint = $1", [address]))?.pool ?? null;
  const card = checkCard(result.decision, { symbol: result.symbol, chain, address, pool });
  const link = `/app/token/${chain}/${result.tokenId}`;
  if (cache.size > 500) for (const [k, c] of cache) if (Date.now() - c.at > CACHE_MS) cache.delete(k);
  cache.set(`${chain}:${address}`, { at: Date.now(), card, link });
  return formatTelegramAlert(card, `${env.appUrl}${link}`);
}
