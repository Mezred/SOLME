import { readableLabel } from "@/lib/format";
import type { RawTx } from "@/lib/providers/helius-history";

/**
 * pump.fun helpers — pure functions, no I/O.
 * Bonding-curve account layout (after the 8-byte discriminator), all u64 little-endian:
 * virtual_token_reserves, virtual_sol_reserves, real_token_reserves, real_sol_reserves, token_total_supply,
 * then `complete` (bool). Market cap is derived from the real reserves on the standard curve
 * (30 virtual SOL / 1,073,000,000 virtual tokens), because some newer curves report other virtual values.
 */
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const INITIAL_REAL_TOKENS = 793_100_000;
const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
const INITIAL_VIRTUAL_SOL = 30;

export interface CurveState {
  progress: number; // 0..1
  marketCapSol: number;
  complete: boolean;
}

export function decodeBondingCurve(base64: string): CurveState | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 49) return null;
  const realTokens = Number(buf.readBigUInt64LE(24)) / 1e6;
  const realSol = Number(buf.readBigUInt64LE(32)) / 1e9;
  const supply = Number(buf.readBigUInt64LE(40)) / 1e6;
  const complete = buf[48] === 1;
  const sold = Math.max(0, INITIAL_REAL_TOKENS - realTokens);
  const vTokens = INITIAL_VIRTUAL_TOKENS - sold;
  const marketCapSol = vTokens > 0 ? ((INITIAL_VIRTUAL_SOL + realSol) / vTokens) * supply : 0;
  return { progress: complete ? 1 : Math.min(1, sold / INITIAL_REAL_TOKENS), marketCapSol, complete };
}

/**
 * Raydium LaunchLab (LetsBonk) PoolState. Layout per docs.raydium.io/products/launchlab/accounts, verified
 * against live pools: u8 status @17 (0 Fund, 1 Migrate, 2 Trade), decimals @18/@19, then u64 supply @21,
 * total_base_sell @29, virtual_base @37, virtual_quote @45, real_base @53, real_quote @61; the seven pubkeys
 * start at 141 (global_config, platform_config, base_mint +64, quote_mint +96, base_vault, quote_vault,
 * creator +192). LetsBonk curves can raise SOL, USD1 or other tokens (e.g. BONK),
 * so the market cap is returned in quote units together with the quote mint.
 */
export const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
// 8 discriminator + epoch u64 + 5 × u8 + 7 × u64 reserves/counters + 3 × u64 fees + 5 × u64 vesting schedule.
const LAUNCHLAB_PUBKEYS_AT = 8 + 8 + 5 + 7 * 8 + 3 * 8 + 5 * 8;

export interface LaunchLabState {
  progress: number;
  complete: boolean;
  marketCapQuote: number;
  baseMint: string;
  quoteMint: string;
  creator: string;
}

export function decodeLaunchLabPool(base64: string): LaunchLabState | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < LAUNCHLAB_PUBKEYS_AT + 224) return null;
  const status = buf[17];
  const baseDec = 10 ** buf[18];
  const quoteDec = 10 ** buf[19];
  const u64 = (o: number) => Number(buf.readBigUInt64LE(o));
  const supply = u64(21) / baseDec;
  const totalBaseSell = u64(29) / baseDec;
  const virtualBase = u64(37) / baseDec;
  const virtualQuote = u64(45) / quoteDec;
  const realBase = u64(53) / baseDec;
  const realQuote = u64(61) / quoteDec;
  const baseLeft = virtualBase - realBase;
  const complete = status >= 1;
  return {
    progress: complete ? 1 : totalBaseSell > 0 ? Math.min(1, realBase / totalBaseSell) : 0,
    complete,
    marketCapQuote: baseLeft > 0 ? ((virtualQuote + realQuote) / baseLeft) * supply : 0,
    baseMint: base58(buf.subarray(LAUNCHLAB_PUBKEYS_AT + 64, LAUNCHLAB_PUBKEYS_AT + 96)),
    quoteMint: base58(buf.subarray(LAUNCHLAB_PUBKEYS_AT + 96, LAUNCHLAB_PUBKEYS_AT + 128)),
    creator: base58(buf.subarray(LAUNCHLAB_PUBKEYS_AT + 192, LAUNCHLAB_PUBKEYS_AT + 224)),
  };
}

/**
 * LaunchLab initialize* instruction args: 8-byte discriminator, decimals u8, then Borsh strings
 * (u32 length + UTF-8) name, symbol, uri. Returns null when the data does not have that shape.
 */
export function parseLaunchLabInitArgs(dataBase58: string): { name: string; symbol: string; uri: string } | null {
  const buf = base58Decode(dataBase58);
  if (!buf || buf.length < 9 + 12) return null;
  let o = 9;
  const str = (max: number) => {
    if (o + 4 > buf.length) return null;
    const len = buf.readUInt32LE(o);
    if (len > max || o + 4 + len > buf.length) return null;
    const s = buf.subarray(o + 4, o + 4 + len).toString("utf8");
    o += 4 + len;
    return s;
  };
  const name = str(64);
  const symbol = name === null ? null : str(32);
  const uri = symbol === null ? null : str(300);
  return name && symbol && uri !== null ? { name: name.slice(0, 120), symbol: symbol.slice(0, 40), uri: uri.slice(0, 500) } : null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ZERO = BigInt(0);
const N58 = BigInt(58);
const N256 = BigInt(256);

function base58Decode(s: string): Buffer | null {
  let n = ZERO;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * N58 + BigInt(i);
  }
  let hex = n === ZERO ? "" : n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function base58(bytes: Uint8Array): string {
  let n = ZERO;
  for (const b of bytes) n = n * N256 + BigInt(b);
  let s = "";
  while (n > ZERO) {
    s = B58[Number(n % N58)] + s;
    n /= N58;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

export type StreamEvent =
  | { kind: "create"; mint: string; creator: string; pool: string; name: string | null; symbol: string | null; uri: string | null; bondingCurve: string | null; initialBuySol: number | null; marketCapSol: number | null }
  | { kind: "migrate"; mint: string }
  // PumpPortal's LetsBonk creates carry the quote mint in `mint` and not the real creator, so only the
  // signature is trusted; the facts are read from the transaction (see launchpad/launchlab.ts).
  | { kind: "launchlab_create"; signature: string };

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parses one PumpPortal message. Subscription acknowledgements and unknown shapes return null. */
export function parseStreamMessage(m: unknown): StreamEvent | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const mint = str(o.mint);
  if (!mint) return null;
  if (o.txType === "create" && o.pool === "bonk") {
    const signature = str(o.signature);
    return signature ? { kind: "launchlab_create", signature } : null;
  }
  if (o.txType === "create") {
    const creator = str(o.traderPublicKey);
    if (!creator) return null;
    return {
      kind: "create",
      mint,
      creator,
      pool: str(o.pool) ?? "pump",
      name: readableLabel(str(o.name)?.slice(0, 120), mint),
      symbol: readableLabel(str(o.symbol)?.slice(0, 40), mint),
      uri: str(o.uri)?.slice(0, 500) ?? null,
      bondingCurve: str(o.bondingCurveKey),
      initialBuySol: num(o.solAmount),
      marketCapSol: num(o.marketCapSol),
    };
  }
  if (o.txType === "migrate" || o.txType === "migration") return { kind: "migrate", mint };
  return null;
}

const keyOf = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);

// The create instruction's log line per launchpad program. Token-program logs such as
// "Instruction: InitializeMint2" do not match because the patterns are anchored.
const CREATE_LOGS: [program: string, pool: "pump" | "bonk", log: RegExp][] = [
  [PUMP_PROGRAM, "pump", /Instruction: Create(V2)?$/],
  [LAUNCHLAB_PROGRAM, "bonk", /Instruction: Initialize(V2|WithToken2022)?$/],
];

/** Finds pump.fun and LetsBonk (LaunchLab) token creations signed by `creator` in a page of its history. */
export function findCreates(creator: string, txs: RawTx[]): { mint: string; time: number; signature: string; pool: "pump" | "bonk" }[] {
  const out: { mint: string; time: number; signature: string; pool: "pump" | "bonk" }[] = [];
  for (const tx of txs) {
    const meta = tx.meta;
    if (!meta || meta.err || !tx.blockTime) continue;
    const keys = tx.transaction.message.accountKeys.map(keyOf);
    if (keys[0] !== creator) continue;
    const logs = meta.logMessages ?? [];
    const match = CREATE_LOGS.find(([program, , log]) => keys.includes(program) && logs.some((l) => log.test(l)));
    if (!match) continue;
    // The new mint is a co-signer of the create transaction and appears in the post token balances.
    const signers = keys.slice(1, tx.transaction.message.header?.numRequiredSignatures ?? 2);
    const mints = new Set((meta.postTokenBalances ?? []).map((b) => b.mint));
    const mint = signers.find((s) => mints.has(s));
    if (mint) out.push({ mint, time: tx.blockTime, signature: tx.transaction.signatures[0], pool: match[1] });
  }
  return out;
}

/**
 * A "proven" dev: dev score at least this, with 2+ recorded launches. Devs with no migrated launch are capped
 * at 40, so this always implies at least one migration that was not dumped. Used by Proven Devs and dev alerts.
 */
export const PROVEN_DEV_SCORE = 60;

/** One recorded launch, as the dev score sees it. */
export interface LaunchOutcome {
  migrated: boolean;
  /** Market cap ~1h after migration held at least half its value at migration (null: not measured yet). */
  held: boolean | null;
  /** The creator sold 5%+ of supply before migration or within the hour after (seen live). */
  devDumped: boolean;
  ageDays: number;
  /** Market cap after migration (held value, or latest for history-only launches). */
  mcapUsd: number | null;
}

export const DEV_SCORE_VERSION = 2;
const HALF_LIFE_DAYS = 30;
/** Small samples are pulled toward the launchpad base rate (~2% of launches migrate). */
const PRIOR_RATE = 0.02;
const PRIOR_WEIGHT = 2;
/** A recency-weighted good-launch rate of 30% earns full marks. */
const FULL_RATE = 0.3;

/** Value of one launch: 0 failed, 0.25 dev dumped, 0.4 migrated then collapsed, 0.75 migrated (not measured yet), 1 held. */
export function launchValue(l: LaunchOutcome): number {
  if (!l.migrated) return 0;
  if (l.devDumped) return 0.25;
  if (l.held === null) return 0.75;
  return l.held ? 1 : 0.4;
}

/**
 * Dev score v2 (0–100): 80% recency-weighted, smoothed launch value (see launchValue; a launch's weight halves every
 * 30 days) + 20% best post-migration market cap ($30k → 0, ~$1M → full). Devs without a migration that held are
 * capped at 40, so "proven" (60+) always means at least one launch that migrated and was not dumped. Confidence
 * comes from the weighted sample size. Describes recorded outcomes only; it does not predict the next launch.
 */
export function devScoreV2(launches: LaunchOutcome[]): { score: number | null; sample: number; confidence: "low" | "medium" | "high" } {
  if (launches.length === 0) return { score: null, sample: 0, confidence: "low" };
  let weight = 0;
  let value = 0;
  let best = 0;
  let good = false;
  for (const l of launches) {
    const w = 0.5 ** (Math.max(0, l.ageDays) / HALF_LIFE_DAYS);
    weight += w;
    value += w * launchValue(l);
    if (l.migrated && !l.devDumped && l.held !== false) {
      good = true;
      best = Math.max(best, l.mcapUsd ?? 0);
    }
  }
  const rate = (value + PRIOR_RATE * PRIOR_WEIGHT) / (weight + PRIOR_WEIGHT);
  const cap = best > 0 ? Math.max(0, Math.min(1, Math.log10(best / 30_000) / 1.5)) : 0;
  const raw = Math.round(100 * (0.8 * Math.min(1, rate / FULL_RATE) + 0.2 * cap));
  return { score: good ? raw : Math.min(40, raw), sample: Math.round(weight * 10) / 10, confidence: weight < 3 ? "low" : weight < 8 ? "medium" : "high" };
}

/** A migration "held" when the market cap an hour later is at least half of what it was at migration. */
export function heldAfterMigration(atMigration: number | null, hourLater: number | null): boolean | null {
  if (!atMigration || hourLater === null) return null;
  return hourLater / atMigration >= 0.5;
}

/** The wallet that first sent SOL to `wallet`, from its oldest transactions (oldest first). */
export function findFunder(wallet: string, txs: RawTx[]): string | null {
  for (const tx of txs) {
    const meta = tx.meta;
    if (!meta || meta.err) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
    const i = keys.indexOf(wallet);
    if (i < 0 || keys[0] === wallet) continue;
    if ((meta.postBalances[i] ?? 0) > (meta.preBalances[i] ?? 0)) return keys[0];
  }
  return null;
}
