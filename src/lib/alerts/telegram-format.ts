import { CHAINS, isChainId } from "@/lib/chains";
import { launchpadName, launchpadUrl } from "@/lib/launchpad/names";

/**
 * Structured alert content for chat apps. Stored on each notification so delivery can lay it out per channel;
 * the plain title/body stay for in-app and email.
 */
export interface AlertCard {
  icon: string;
  headline: string;
  symbol?: string | null;
  chain?: string | null;
  /** Launchpad pool (pump, bonk) when the coin is on a bonding curve. */
  pool?: string | null;
  /** Contract address, shown on its own line so it copies with one tap. */
  address?: string | null;
  facts: [string, string][];
  note?: string;
  /** Background scam check of the coin; the sent message is edited when it changes (see src/lib/launchpad/checks.ts). */
  check?: AlertCheck;
  /** Sent as a Telegram reply to the user's earlier alert about this contract (e.g. "dev sold" under the launch alert). */
  replyTo?: string;
  /** What the alert's 🔕 buttons mute for 24h (and what an active mute silences). Set by the alert engine. */
  mute?: MuteTarget[];
}

export interface MuteTarget {
  kind: "dev" | "wallet" | "coin";
  value: string;
}

/** Inline keyboard button: a link, or a callback handled by the bot (see pollTelegramUpdates). */
export type TgButton = { text: string; url: string } | { text: string; callback_data: string };

const MUTE_LABEL: Record<MuteTarget["kind"], string> = { coin: "🔕 Coin 24h", dev: "🔕 Dev 24h", wallet: "🔕 Wallet 24h" };

/** Callback data for a mute button (Telegram allows 64 bytes; addresses are at most 44). */
export const muteData = (m: MuteTarget) => `m:${m.kind[0]}:${m.value}`;

export function parseMuteData(data: string): MuteTarget | null {
  const m = data.match(/^m:([cdw]):([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/);
  if (!m) return null;
  return { kind: m[1] === "c" ? "coin" : m[1] === "d" ? "dev" : "wallet", value: m[2] };
}

export interface AlertCheck {
  status: "pending" | "passed" | "failed" | "no_market";
  reason?: string | null;
}

function checkLine(c: AlertCheck): string {
  const why = c.reason ? ` — ${esc(c.reason)}` : "";
  if (c.status === "passed") return `✅ <b>Scam check passed</b>${why}`;
  if (c.status === "failed") return `❌ <b>Scam check failed</b>${why}`;
  if (c.status === "no_market") return "⚪ <b>Scam check:</b> no DEX market yet, retrying";
  return "⏳ <b>Scam check running…</b>";
}

export interface TelegramMessage {
  text: string;
  buttons: TgButton[][];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram HTML message: header, coin line, tap-to-copy contract, one fact per line, link buttons. */
export function formatTelegramAlert(card: AlertCard, appUrl: string | null): TelegramMessage {
  const chain = card.chain && isChainId(card.chain) ? CHAINS[card.chain] : null;
  const lines = [`${card.icon} <b>${esc(card.headline.toUpperCase())}</b>`];

  const coin = [card.symbol ? `<b>$${esc(card.symbol)}</b>` : null, chain?.name ?? null, card.pool ? esc(launchpadName(card.pool)) : null].filter(Boolean);
  if (coin.length) lines.push("", coin.join(" · "));
  if (card.address) lines.push(`<code>${esc(card.address)}</code>`);

  if (card.facts.length) {
    lines.push("");
    for (const [label, value] of card.facts) lines.push(`• ${esc(label)}: <b>${esc(value)}</b>`);
  }
  if (card.check) lines.push("", checkLine(card.check));
  if (card.note) lines.push("", `<i>${esc(card.note)}</i>`);

  const links: { text: string; url: string }[] = [];
  // Telegram rejects buttons pointing at localhost/http, so the SOLME button only appears on a public https URL.
  if (appUrl?.startsWith("https://")) links.push({ text: "SOLME", url: appUrl });
  if (card.address && chain) {
    links.push({ text: "DexScreener", url: `https://dexscreener.com/${chain.dexscreenerId}/${card.address}` });
    const pad = card.pool ? launchpadUrl(card.pool, card.address) : null;
    if (pad) links.push({ text: launchpadName(card.pool!), url: pad });
    links.push({ text: "Explorer", url: chain.explorerAddress(card.address) });
  }
  // Two buttons per row reads well on a phone; mute buttons go on their own last row.
  const buttons: TelegramMessage["buttons"] = [];
  for (let i = 0; i < links.length; i += 2) buttons.push(links.slice(i, i + 2));
  if (card.mute?.length) buttons.push(card.mute.slice(0, 2).map((m) => ({ text: MUTE_LABEL[m.kind], callback_data: muteData(m) })));
  return { text: lines.join("\n"), buttons };
}

/** A launch_checks row as an alert check (null passed + a check time = no DEX market yet). */
export function launchCheckToAlert(row: { passed: boolean | null; reason: string | null } | null | undefined): AlertCheck {
  if (!row) return { status: "pending" };
  if (row.passed === true) return { status: "passed", reason: row.reason };
  if (row.passed === false) return { status: "failed", reason: row.reason };
  // The check errored and will be retried: still running as far as the reader is concerned.
  return row.reason?.startsWith("Check failed") ? { status: "pending" } : { status: "no_market" };
}

/** One message for many alerts (quiet hours, bursts): one line each with the coin and its contract. */
export function formatTelegramDigest(header: string, items: { title: string; card: AlertCard | null }[], max = 15): string {
  const lines = [`<b>${esc(header)}</b>`, ""];
  for (const { title, card } of items.slice(0, max)) {
    if (!card) {
      lines.push(`• ${esc(title)}`);
      continue;
    }
    const coin = card.symbol ? ` <b>$${esc(card.symbol)}</b>` : "";
    lines.push(`• ${card.icon} ${esc(card.headline)}${coin}${card.address ? `\n   <code>${esc(card.address)}</code>` : ""}`);
  }
  if (items.length > max) lines.push("", `…and ${items.length - max} more in SOLME → Alerts.`);
  return lines.join("\n");
}

/** Minutes since midnight of "HH:MM". */
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when `now` falls inside the quiet window in `timeZone` (windows may cross midnight, e.g. 23:00–07:00). */
export function inQuietHours(start: string | null, end: string | null, timeZone: string, now = new Date()): boolean {
  if (!start || !end || start === end) return false;
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    local = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  }
  const m = minutes(local);
  const s = minutes(start);
  const e = minutes(end);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export const usd = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a >= 1 ? a.toFixed(2) : a.toPrecision(3);
  return `${v < 0 ? "-" : ""}$${s}`;
};

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
