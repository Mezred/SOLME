import { deliverNotifications, evaluateAlerts } from "@/lib/alerts/engine";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";
import { getRawTransaction, getTokenSupply } from "@/lib/providers/helius-history";
import { extractSwap, extractTrades, type Swap } from "./scoring";
import { recordSwaps, solPriceUsd, WATCH_MIN_SCORE, type FoundSwap } from "./smart-money";

const log = logger("wallet-stream");

/**
 * Live feed for the best smart wallets and every followed Solana wallet: one standard `logsSubscribe` (mentions) per
 * wallet on Helius's websocket, so a buy is recorded and alerted seconds after it lands instead of on the next
 * ~90s poll. Standard websockets work on every Helius plan and are metered by data (~20 credits/MB; a swap
 * notification is a few KB); each swap transaction is then fetched once (1 credit). Wallets beyond LIVE_MAX stay on
 * polling (watchSmartWallets), which also skips live wallets only while the socket is connected.
 * The same socket watches the creators of recently alerted proven-dev coins; a sale of their own coin is stored in
 * dev_sells and sent as a "Dev sold" reply under the launch alert (evaluated with the dev_deploy rules).
 */
export const LIVE_MAX = 100;
/** Creators of proven-dev coins someone was alerted on in the last few hours, watched for sales of that coin. */
export const CREATORS_MAX = 50;
// Short, so the creator of a coin just alerted is watched within a minute (the query is cheap; subscribing is incremental).
const REFRESH_MS = 60_000;
const KEEPALIVE_MS = 60_000;
const SILENCE_MS = 3 * 60_000;
const PROCESS_MS = 1_000;
const QUEUE_MAX = 1_000;

/** Programs every transaction touches: a wallet notification that invokes nothing else is a transfer, not a swap. */
const PLUMBING = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "AddressLookupTab1e1111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
]);

/** True when the logs show a program beyond plumbing (a DEX, aggregator or launchpad), i.e. maybe a swap. */
export function mayBeSwap(logs: string[]): boolean {
  return logs.some((l) => {
    const m = l.match(/^Program (\w{32,44}) invoke/);
    return m !== null && !PLUMBING.has(m[1]);
  });
}

interface Wallet {
  /** wallet_profiles id, or `creator:<address>` for a watched launch creator. */
  id: string;
  address: string;
}

const isCreator = (w: Wallet) => w.id.startsWith("creator:");

interface State {
  ws: WebSocket | null;
  connected: boolean;
  retry: number;
  nextId: number;
  /** subscription id → wallet, and the reverse. */
  subs: Map<number, Wallet>;
  byWallet: Map<string, number>;
  /** request id → wallet awaiting its subscription id. */
  requests: Map<number, Wallet>;
  queue: { wallet: Wallet; signature: string; tries: number }[];
  lastMessageAt: number;
  /** When the socket last dropped (null while connected). */
  downSince: number | null;
  busy: boolean;
  timers: NodeJS.Timeout[];
}

const g = globalThis as unknown as { __nxWalletStream?: State };

/** Wallet ids the live feed is covering right now (empty when disconnected, so polling takes over). */
export function liveWalletIds(): string[] {
  const s = g.__nxWalletStream;
  return s?.connected ? [...s.byWallet.keys()].filter((id) => !id.startsWith("creator:")) : [];
}

export function startSmartWalletStream() {
  if (g.__nxWalletStream || env.demoMode || !env.heliusApiKey || typeof WebSocket === "undefined") return;
  const s: State = { ws: null, connected: false, retry: 0, nextId: 1, subs: new Map(), byWallet: new Map(), requests: new Map(), queue: [], lastMessageAt: Date.now(), downSince: Date.now(), busy: false, timers: [] };
  g.__nxWalletStream = s;
  connect(s);
  s.timers.push(setInterval(() => void refresh(s).catch((err) => log.warn("Wallet list refresh failed", { error: errorMessage(err) })), REFRESH_MS));
  s.timers.push(setInterval(() => void processQueue(s), PROCESS_MS));
  s.timers.push(
    setInterval(() => {
      if (!s.connected) return;
      if (Date.now() - s.lastMessageAt > SILENCE_MS) {
        log.warn("Wallet stream silent, reconnecting");
        s.ws?.close();
        return;
      }
      // Browser-style WebSocket has no ping frames: a tiny request keeps the connection active (the error reply
      // proves the socket is alive).
      send(s, { jsonrpc: "2.0", id: s.nextId++, method: "ping" });
    }, KEEPALIVE_MS),
  );
  log.info("Smart wallet stream started");
}

function send(s: State, msg: unknown) {
  if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
}

function connect(s: State) {
  const ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${env.heliusApiKey}`);
  s.ws = ws;
  ws.onopen = () => {
    s.retry = 0;
    s.connected = true;
    s.downSince = null;
    s.lastMessageAt = Date.now();
    void refresh(s).catch((err) => log.warn("Wallet list refresh failed", { error: errorMessage(err) }));
  };
  ws.onmessage = (e) => {
    s.lastMessageAt = Date.now();
    let msg: { id?: number; result?: unknown; method?: string; params?: { subscription: number; result: { value: { signature: string; err: unknown; logs: string[] | null } } } };
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    handleMessage(s, msg);
  };
  ws.onerror = () => {}; // onclose follows and handles the retry
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = null;
    s.connected = false;
    s.downSince ??= Date.now();
    s.subs.clear();
    s.byWallet.clear();
    s.requests.clear();
    const delay = Math.min(60_000, 2_000 * 2 ** s.retry++);
    s.timers.push(setTimeout(() => connect(s), delay));
  };
}

export function handleMessage(s: Pick<State, "subs" | "byWallet" | "requests" | "queue">, msg: { id?: number; result?: unknown; method?: string; params?: { subscription: number; result: { value: { signature: string; err: unknown; logs: string[] | null } } } }) {
  if (msg.id !== undefined && s.requests.has(msg.id)) {
    const wallet = s.requests.get(msg.id)!;
    s.requests.delete(msg.id);
    if (typeof msg.result === "number") {
      s.subs.set(msg.result, wallet);
      s.byWallet.set(wallet.id, msg.result);
    }
    return;
  }
  if (msg.method !== "logsNotification" || !msg.params) return;
  const wallet = s.subs.get(msg.params.subscription);
  const v = msg.params.result.value;
  if (!wallet || v.err || !mayBeSwap(v.logs ?? [])) return;
  if (s.queue.length < QUEUE_MAX && !s.queue.some((q) => q.signature === v.signature && q.wallet.id === wallet.id)) {
    s.queue.push({ wallet, signature: v.signature, tries: 0 });
  }
}

/** Subscribes the wanted wallets that are not subscribed yet and drops the ones that left the list. */
async function refresh(s: State) {
  if (!s.connected) return;
  const wanted = await query<Wallet>(
    `SELECT id, address FROM (
       SELECT w.id, w.address, 0 AS rank, 100 AS score FROM wallet_profiles w
        WHERE w.chain = 'solana' AND EXISTS (SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = w.id)
       UNION ALL
       SELECT w.id, w.address, 1, s.score FROM wallet_scores s JOIN wallet_profiles w ON w.id = s.wallet_id
        WHERE w.chain = 'solana' AND s.score >= $1 AND NOT s.bot_like) x
     GROUP BY id, address ORDER BY min(rank), max(score) DESC LIMIT $2`,
    [WATCH_MIN_SCORE, LIVE_MAX],
  );
  const creators = await query<{ creator: string }>(
    `SELECT l.creator FROM launchpad_tokens l
      WHERE l.chain = 'solana' AND l.created_at > now() - interval '6 hours'
        AND EXISTS (SELECT 1 FROM alert_events e JOIN alert_rules r ON r.id = e.rule_id WHERE r.rule_type = 'dev_deploy' AND e.dedup_key = 'dev:' || l.mint)
      GROUP BY l.creator ORDER BY max(l.created_at) DESC LIMIT $1`,
    [CREATORS_MAX],
  );
  wanted.push(...creators.map((c) => ({ id: `creator:${c.creator}`, address: c.creator })));
  const keep = new Set(wanted.map((w) => w.id));
  for (const [walletId, sub] of s.byWallet) {
    if (keep.has(walletId)) continue;
    send(s, { jsonrpc: "2.0", id: s.nextId++, method: "logsUnsubscribe", params: [sub] });
    s.byWallet.delete(walletId);
    s.subs.delete(sub);
  }
  const requested = new Set([...s.requests.values()].map((w) => w.id));
  let added = 0;
  for (const w of wanted) {
    if (s.byWallet.has(w.id) || requested.has(w.id)) continue;
    const id = s.nextId++;
    s.requests.set(id, w);
    send(s, { jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [w.address] }, { commitment: "confirmed" }] });
    added++;
  }
  if (added) log.info("Wallet stream subscribing", { added, live: s.byWallet.size + s.requests.size });
}

let solCache: { at: number; usd: number | null } = { at: 0, usd: null };

/** Fetches queued transactions, records swaps and pushes smart-wallet alerts right away. */
async function processQueue(s: State) {
  if (s.busy || s.queue.length === 0) return;
  s.busy = true;
  try {
    if (Date.now() - solCache.at > 60_000) solCache = { at: Date.now(), usd: await solPriceUsd() };
    const batch = s.queue.splice(0, 10);
    const found: FoundSwap[] = [];
    let devSold = false;
    for (const item of batch) {
      try {
        const tx = await getRawTransaction(item.signature);
        // "confirmed" notifications can arrive just before the transaction is queryable: retry a couple of times.
        if (!tx) {
          if (item.tries < 3) s.queue.push({ ...item, tries: item.tries + 1 });
          continue;
        }
        if (isCreator(item.wallet)) {
          const swap = extractSwap(item.wallet.address, tx, solCache.usd);
          if (swap?.side === "sell" && (await recordDevSell(item.wallet.address, swap))) devSold = true;
          continue;
        }
        for (const t of extractTrades(item.wallet.address, tx, solCache.usd)) {
          found.push({ walletId: item.wallet.id, signature: t.signature, time: t.time, mint: t.mint, side: t.side, amount: t.tokenAmount, sol: t.sol });
        }
        // Keep the poll cursor current so a fallback to polling does not re-read what the stream already handled.
        await query(
          `INSERT INTO wallet_watch_state (wallet_id, last_signature, polled_at) VALUES ($1, $2, now())
           ON CONFLICT (wallet_id) DO UPDATE SET last_signature = EXCLUDED.last_signature, polled_at = now()`,
          [item.wallet.id, item.signature],
        );
      } catch (err) {
        log.warn("Wallet stream transaction failed", { signature: item.signature, error: errorMessage(err) });
      }
    }
    const added = await recordSwaps(found);
    // New buys and sells: buy alerts, group buys, "smart wallet sold" follow-ups and followed-wallet activity.
    const types = [...(added > 0 ? ["smart_wallet_buy", "smart_group_buy", "wallet_activity"] : []), ...(devSold ? ["dev_deploy"] : [])];
    if (types.length && (await evaluateAlerts(types)) > 0) await deliverNotifications();
  } catch (err) {
    log.warn("Wallet stream processing failed", { error: errorMessage(err) });
  } finally {
    s.busy = false;
  }
}

/** Stores a creator's sale of a coin they launched (in the last day). Returns false for any other token. */
export async function recordDevSell(creator: string, swap: Swap): Promise<boolean> {
  const launch = await queryOne<{ mint: string }>(
    "SELECT mint FROM launchpad_tokens WHERE mint = $1 AND creator = $2 AND created_at > now() - interval '1 day'",
    [swap.mint, creator],
  );
  if (!launch) return false;
  // pump.fun and LetsBonk mints have a fixed 1B supply; ask the chain only for anything else.
  const pool = (await queryOne<{ pool: string }>("SELECT pool FROM launchpad_tokens WHERE mint = $1", [swap.mint]))?.pool;
  const supply = pool === "pump" || pool === "bonk" ? 1_000_000_000 : await getTokenSupply(swap.mint).catch(() => null);
  const rows = await query(
    `INSERT INTO dev_sells (signature, mint, creator, sol, supply_pct, sold_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
     ON CONFLICT DO NOTHING RETURNING signature`,
    [swap.signature, swap.mint, creator, swap.sol, supply ? (swap.tokenAmount / supply) * 100 : null, swap.time],
  );
  return rows.length > 0;
}

/** Stream status for the admin / health views. */
export function walletStreamStatus() {
  const s = g.__nxWalletStream;
  return { running: Boolean(s), connected: s?.connected ?? false, wallets: s?.byWallet.size ?? 0, queued: s?.queue.length ?? 0, downSince: s?.downSince ?? null };
}
