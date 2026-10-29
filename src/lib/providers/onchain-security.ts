import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { base58, LAUNCHLAB_PROGRAM, PUMP_PROGRAM } from "@/lib/launchpad/pump";
import { getAccounts, getLargestTokenAccounts } from "./helius-history";
import type { SecurityCheck } from "./types";

/**
 * Security facts read from the source instead of a third party:
 *  - Solana: the mint account itself (1 Helius credit per 100 mints): mint / freeze authority and the Token-2022
 *    extensions that can trap buyers (permanent delegate, default-frozen accounts, pause, transfer fee and hook).
 * Results use the same check keys as GoPlus where they overlap and replace those (see goplus.ts).
 */

export const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface MintInfo {
  token2022: boolean;
  mintAuthority: boolean;
  freezeAuthority: boolean;
  /** Highest configured transfer fee, basis points (Token-2022). */
  transferFeeBps: number | null;
  transferHook: boolean;
  permanentDelegate: boolean;
  defaultFrozen: boolean;
  pausable: boolean;
  paused: boolean;
  nonTransferable: boolean;
  closeAuthority: boolean;
}

const nonZero = (b: Buffer) => b.some((x) => x !== 0);

/** Decodes an SPL / Token-2022 mint account (base64). Null when the data is not a mint. */
export function decodeMint(base64: string, owner: string): MintInfo | null {
  const buf = Buffer.from(base64, "base64");
  if ((owner !== SPL_TOKEN && owner !== TOKEN_2022) || buf.length < 82) return null;
  const info: MintInfo = {
    token2022: owner === TOKEN_2022,
    mintAuthority: buf.readUInt32LE(0) === 1,
    freezeAuthority: buf.readUInt32LE(46) === 1,
    transferFeeBps: null,
    transferHook: false,
    permanentDelegate: false,
    defaultFrozen: false,
    pausable: false,
    paused: false,
    nonTransferable: false,
    closeAuthority: false,
  };
  // Token-2022 extensions: account type byte at 165 (1 = mint), then TLV entries (u16 type, u16 length, value).
  if (info.token2022 && buf.length > 166 && buf[165] === 1) {
    let at = 166;
    while (at + 4 <= buf.length) {
      const type = buf.readUInt16LE(at);
      const len = buf.readUInt16LE(at + 2);
      const v = buf.subarray(at + 4, at + 4 + len);
      if (type === 0 || v.length < len) break;
      if (type === 1 && len >= 108) info.transferFeeBps = Math.max(v.readUInt16LE(88), v.readUInt16LE(106)); // older / newer fee
      if (type === 3 && len >= 32) info.closeAuthority = nonZero(v.subarray(0, 32));
      if (type === 6 && len >= 1) info.defaultFrozen = v[0] === 2;
      if (type === 9) info.nonTransferable = true;
      if (type === 12 && len >= 32) info.permanentDelegate = nonZero(v.subarray(0, 32));
      if (type === 14 && len >= 64) info.transferHook = nonZero(v.subarray(32, 64));
      if (type === 26 && len >= 33) {
        info.pausable = nonZero(v.subarray(0, 32));
        info.paused = v[32] === 1;
      }
      at += 4 + len;
    }
  }
  return info;
}

const pass = (key: string, label: string, detail: string): SecurityCheck => ({ key, label, result: "pass", detail });

/** The mint's own security checks. Keys match GoPlus's where they overlap (mint_authority, freeze_authority, transfer_fee, transfer_hook, non_transferable, closable). */
export function mintChecks(m: MintInfo): SecurityCheck[] {
  const checks: SecurityCheck[] = [
    m.mintAuthority
      ? { key: "mint_authority", label: "Mint authority", result: "fail", detail: "Mint authority is active; supply can be inflated (on-chain)" }
      : pass("mint_authority", "Mint authority", "Mint authority revoked (on-chain)"),
    m.freezeAuthority
      ? { key: "freeze_authority", label: "Freeze authority", result: "fail", detail: "Freeze authority is active; your tokens can be frozen (on-chain)" }
      : pass("freeze_authority", "Freeze authority", "Freeze authority revoked (on-chain)"),
  ];
  if (!m.token2022) return [...checks, pass("token_extensions", "Token program", "Classic SPL token: no Token-2022 extensions")];
  const fee = m.transferFeeBps ?? 0;
  checks.push(
    fee >= 1000
      ? { key: "transfer_fee", label: "Transfer fee", result: "fail", detail: `${(fee / 100).toFixed(1)}% taken on every transfer, including sells` }
      : fee > 0
        ? { key: "transfer_fee", label: "Transfer fee", result: "warn", detail: `${(fee / 100).toFixed(2)}% taken on every transfer` }
        : pass("transfer_fee", "Transfer fee", "No transfer fee"),
    m.permanentDelegate
      ? { key: "permanent_delegate", label: "Permanent delegate", result: "fail", detail: "A permanent delegate can move or burn anyone's tokens" }
      : pass("permanent_delegate", "Permanent delegate", "No permanent delegate"),
    m.defaultFrozen
      ? { key: "default_frozen", label: "Default frozen accounts", result: "fail", detail: "New holders' accounts start frozen: buyers may not be able to sell" }
      : pass("default_frozen", "Default frozen accounts", "New accounts are not frozen"),
    m.paused
      ? { key: "paused", label: "Pause", result: "fail", detail: "Transfers are paused right now" }
      : m.pausable
        ? { key: "paused", label: "Pause", result: "warn", detail: "An authority can pause all transfers" }
        : pass("paused", "Pause", "Transfers cannot be paused"),
    m.transferHook
      ? { key: "transfer_hook", label: "Transfer hook", result: "warn", detail: "A custom program runs on every transfer and can block sells" }
      : pass("transfer_hook", "Transfer hook", "No transfer hook"),
    m.nonTransferable
      ? { key: "non_transferable", label: "Non-transferable", result: "fail", detail: "Token is non-transferable" }
      : pass("non_transferable", "Non-transferable", "Token is transferable"),
    m.closeAuthority
      ? { key: "closable", label: "Closable mint", result: "warn", detail: "Mint account can be closed" }
      : pass("closable", "Closable mint", "Mint cannot be closed"),
  );
  return checks;
}

/** On-chain mint checks for several Solana mints in one call. Mints that cannot be read are left out. */
export async function solanaMintChecks(mints: string[]): Promise<Map<string, SecurityCheck[]>> {
  const out = new Map<string, SecurityCheck[]>();
  if (!env.heliusApiKey || mints.length === 0) return out;
  const accounts = await getAccounts(mints).catch(() => new Map<string, { owner: string; data: string } | null>());
  for (const m of mints) {
    const a = accounts.get(m);
    const info = a ? decodeMint(a.data, a.owner) : null;
    if (info) out.set(m, mintChecks(info));
  }
  return out;
}

export const SOLANA_CRITICAL = ["permanent_delegate", "default_frozen", "paused"];
// ───────────────────────── Solana LP: burned / locked ─────────────────────────

export const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const CURVE_PROGRAMS = new Set([PUMP_PROGRAM, LAUNCHLAB_PROGRAM]);
/** LP held by these programs (or the incinerator) cannot be withdrawn by its owner. */
const LP_LOCKERS = new Set([
  "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE", // Raydium Burn & Earn
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn", // Jupiter Lock
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", // Streamflow
]);
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";

export interface PoolLp {
  dex: "PumpSwap" | "Raydium CPMM";
  lpMint: string;
  /** LP supply as the pool records it (burning LP tokens lowers the mint's supply, not this). */
  poolLpSupply: number;
  mints: [string, string];
}

/**
 * Reads the LP mint and recorded LP supply of a PumpSwap or Raydium CPMM pool account (layouts verified against
 * mainnet pools, Oct 2026). Null for any other program: concentrated-liquidity pools have no LP token.
 */
export function decodePool(owner: string, base64: string): PoolLp | null {
  const b = Buffer.from(base64, "base64");
  const key = (at: number) => base58(b.subarray(at, at + 32));
  if (owner === PUMPSWAP_PROGRAM && b.length >= 211) return { dex: "PumpSwap", lpMint: key(107), poolLpSupply: Number(b.readBigUInt64LE(203)), mints: [key(43), key(75)] };
  if (owner === RAYDIUM_CPMM_PROGRAM && b.length >= 341) return { dex: "Raydium CPMM", lpMint: key(136), poolLpSupply: Number(b.readBigUInt64LE(333)), mints: [key(168), key(200)] };
  return null;
}

/**
 * Pure: LP shares → the lp_lock check. `lockedRaw`: LP held by lockers or the incinerator; `creatorRaw`: LP still held by
 * the coin's own creator. Withdrawable LP held by someone else on a launchpad coin is usually the launch platform's
 * (LetsBonk/LaunchLab migrations), so that is a warning; held by the creator, or on a coin with no recorded launch, it fails.
 */
export function lpCheck(
  dex: string,
  poolLpSupply: number,
  mintSupply: number,
  lockedRaw: number,
  opts: { creatorRaw?: number; fromLaunchpad?: boolean; topHolder?: string | null } = {},
): SecurityCheck {
  const label = "Liquidity lock";
  if (poolLpSupply <= 0) return { key: "lp_lock", label, result: "unavailable", detail: `${dex}: pool reports no LP supply` };
  const burned = Math.max(0, poolLpSupply - mintSupply);
  const pct = (x: number) => Math.floor((x / poolLpSupply) * 10_000) / 100;
  const safe = Math.min(100, pct(burned) + pct(lockedRaw));
  const open = Math.round(100 - safe);
  const parts = [pct(burned) > 0 ? `${pct(burned).toFixed(1)}% burned` : null, pct(lockedRaw) > 0 ? `${pct(lockedRaw).toFixed(1)}% locked` : null].filter(Boolean).join(", ") || "none burned or locked";
  if (safe >= 95) return { key: "lp_lock", label, result: "pass", detail: `${dex} LP: ${parts}` };
  const byCreator = pct(opts.creatorRaw ?? 0);
  if (byCreator >= 5) return { key: "lp_lock", label, result: "fail", detail: `${dex} LP: ${parts}; the creator holds ${byCreator.toFixed(0)}% and can pull the liquidity` };
  const who = opts.topHolder ? `wallet ${opts.topHolder.slice(0, 4)}…${opts.topHolder.slice(-4)}` : "another wallet";
  if (opts.fromLaunchpad) return { key: "lp_lock", label, result: "warn", detail: `${dex} LP: ${parts}; ${open}% held by ${who} (usually the launch platform), not the creator` };
  if (safe >= 50) return { key: "lp_lock", label, result: "warn", detail: `${dex} LP: ${parts}; ${open}% can still be withdrawn by ${who}` };
  return { key: "lp_lock", label, result: "fail", detail: `${dex} LP: ${parts}; ${who} holds ${open}% and can pull the liquidity` };
}

/**
 * LP burned / locked for Solana coins, from each coin's main pool (token mint → pool address). Coins still on a pump.fun
 * or LetsBonk curve pass (curve liquidity cannot be pulled). About 2–4 Helius credits per migrated coin.
 */
export async function solanaLpChecks(pools: Map<string, string>): Promise<Map<string, SecurityCheck>> {
  const out = new Map<string, SecurityCheck>();
  if (!env.heliusApiKey || pools.size === 0) return out;
  const poolAccounts = await getAccounts([...new Set(pools.values())]).catch(() => null);
  if (!poolAccounts) return out;
  const decoded = new Map<string, PoolLp>();
  for (const [mint, pool] of pools) {
    const a = poolAccounts.get(pool);
    if (!a) continue;
    if (CURVE_PROGRAMS.has(a.owner)) {
      out.set(mint, { key: "lp_lock", label: "Liquidity lock", result: "pass", detail: "Still on its launchpad bonding curve: liquidity cannot be pulled" });
      continue;
    }
    const lp = decodePool(a.owner, a.data);
    if (lp && lp.mints.includes(mint)) decoded.set(mint, lp);
  }
  if (!decoded.size) return out;
  // Recorded launches: whose coin it is (their LP is a red flag) and that it came from a launchpad.
  const launches = new Map(
    (await query<{ mint: string; creator: string }>("SELECT mint, creator FROM launchpad_tokens WHERE mint = ANY($1)", [[...decoded.keys()]]).catch(() => [])).map((r) => [r.mint, r.creator]),
  );
  const lpMints = await getAccounts([...new Set([...decoded.values()].map((d) => d.lpMint))]).catch(() => null);
  for (const [mint, lp] of decoded) {
    const m = lpMints?.get(lp.lpMint);
    if (!m) continue;
    const mb = Buffer.from(m.data, "base64");
    if (mb.length < 82) continue;
    const supply = Number(mb.readBigUInt64LE(36));
    let locked = 0;
    let byCreator = 0;
    let top: string | null = null;
    // Fully burned needs no holder lookup; otherwise check who holds the rest.
    if (supply > 0) {
      try {
        const decimals = mb[44];
        const holders = (await getLargestTokenAccounts(lp.lpMint)).slice(0, 10);
        const tokenAccounts = await getAccounts(holders.map((h) => h.address));
        const owners = holders.map((h) => {
          const t = tokenAccounts.get(h.address);
          return t ? base58(Buffer.from(t.data, "base64").subarray(32, 64)) : null;
        });
        const ownerAccounts = await getAccounts(owners.filter((o): o is string => o !== null));
        holders.forEach((h, i) => {
          const o = owners[i];
          if (!o) return;
          const raw = (h.uiAmount ?? 0) * 10 ** decimals;
          if (o === INCINERATOR || LP_LOCKERS.has(ownerAccounts.get(o)?.owner ?? "")) locked += raw;
          else {
            top ??= o;
            if (o === launches.get(mint)) byCreator += raw;
          }
        });
      } catch {
        continue; // could not see the holders: leave the check out rather than guess
      }
    }
    out.set(mint, lpCheck(lp.dex, lp.poolLpSupply, supply, locked, { creatorRaw: byCreator, fromLaunchpad: launches.has(mint), topHolder: top }));
  }
  return out;
}
