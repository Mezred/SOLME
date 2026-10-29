import { createHash } from "node:crypto";
import { type ChainId } from "@/lib/chains";
import { env } from "@/lib/env";
import { ProviderClient } from "./http";
import { SOLANA_CRITICAL, solanaLpChecks, solanaMintChecks } from "./onchain-security";
import type { SecurityCheck, SecurityProvider, SecurityReport } from "./types";

/**
 * GoPlus Security token API. Docs: https://docs.gopluslabs.io/reference/api-overview
 * Works without a key at a low rate; GOPLUS_APP_KEY/SECRET raise limits.
 * Observed behaviour (verified Oct 2026): the Solana endpoint accepts comma-separated
 * addresses but return a result only for the FIRST one, so every token is queried individually.
 * Empty-string fields (e.g. buy_tax before a token is tradable) mean "not determined", not zero.
 */
const gp = new ProviderClient("goplus", "https://api.gopluslabs.io/api/v1", { perMinute: 25, burst: 5 });

let accessToken: { token: string; expires: number } | null = null;
async function authHeaders(): Promise<Record<string, string>> {
  if (!env.goplusAppKey || !env.goplusAppSecret) return {};
  if (accessToken && accessToken.expires > Date.now() + 60_000) return { Authorization: accessToken.token };
  const time = Math.floor(Date.now() / 1000);
  const sign = createHash("sha1").update(`${env.goplusAppKey}${time}${env.goplusAppSecret}`).digest("hex");
  const res = await gp.post<{ result?: { access_token: string; expires_in: number } }>("/token", {
    app_key: env.goplusAppKey,
    sign,
    time,
  });
  if (!res.result) return {};
  accessToken = { token: res.result.access_token, expires: Date.now() + res.result.expires_in * 1000 };
  return { Authorization: accessToken.token };
}

type Raw = Record<string, unknown>;

/** "1" → true, "0" → false, missing/empty → null (unknown). */
const flag = (v: unknown): boolean | null => (v === "1" || v === 1 ? true : v === "0" || v === 0 ? false : null);
const pct = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x * 100 : null;
};
const authorityActive = (v: unknown): boolean | null => {
  const o = v as { status?: string } | undefined;
  return o && typeof o === "object" ? flag(o.status) : null;
};

function check(key: string, label: string, value: boolean | null, bad: "fail" | "warn", detailBad: string, detailOk: string): SecurityCheck {
  if (value === null) return { key, label, result: "unavailable", detail: "Not reported by provider" };
  return value ? { key, label, result: bad, detail: detailBad } : { key, label, result: "pass", detail: detailOk };
}

function top10(holders: unknown, exclude: Set<string>): number | null {
  if (!Array.isArray(holders) || holders.length === 0) return null;
  const list = holders as { address?: string; account?: string; percent?: string; is_locked?: number; tag?: string }[];
  const eligible = list.filter((h) => {
    const addr = (h.address ?? h.account ?? "").toLowerCase();
    // Exclude liquidity pools, locked balances and burn addresses — they are not holder concentration.
    return !exclude.has(addr) && h.is_locked !== 1 && !/dead|0x0{40}/i.test(addr);
  });
  const sum = eligible.slice(0, 10).reduce((s, h) => s + (pct(h.percent) ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

function concentrationCheck(p: number | null): SecurityCheck {
  const key = "top_holder_concentration";
  const label = "Top-10 holder concentration";
  if (p === null) return { key, label, result: "unavailable", detail: "Holder list not available" };
  const detail = `Top 10 non-pool holders own ${p.toFixed(1)}%`;
  return { key, label, result: p > 50 ? "fail" : p > 30 ? "warn" : "pass", detail };
}

function riskLevel(checks: SecurityCheck[], criticalKeys: string[]): SecurityReport["riskLevel"] {
  const available = checks.filter((c) => c.result !== "unavailable");
  if (available.length === 0) return "unknown";
  if (checks.some((c) => c.result === "fail" && criticalKeys.includes(c.key))) return "critical";
  const fails = checks.filter((c) => c.result === "fail").length;
  const warns = checks.filter((c) => c.result === "warn").length;
  if (fails > 0 || warns >= 3) return "high";
  if (warns > 0) return "medium";
  return "low";
}

/** Own on-chain / simulation checks replace GoPlus checks with the same key and are added otherwise. */
function merge(checks: SecurityCheck[], extra: SecurityCheck[]): SecurityCheck[] {
  const out = checks.map((c) => extra.find((e) => e.key === c.key && e.result !== "unavailable") ?? c);
  for (const e of extra) if (!checks.some((c) => c.key === e.key)) out.push(e);
  return out;
}

function finalize(provider: string, checks: SecurityCheck[], criticalKeys: string[], limitations: string, holderCount: number | null, top: number | null, raw: unknown): SecurityReport {
  const unavailable = checks.filter((c) => c.result === "unavailable").map((c) => c.key);
  const status = unavailable.length === checks.length ? "unavailable" : unavailable.length > 0 ? "partial" : "complete";
  return {
    provider,
    checkedAt: new Date(),
    status,
    riskLevel: status === "unavailable" ? "unknown" : riskLevel(checks, criticalKeys),
    checks,
    unavailable,
    limitations,
    holderCount,
    top10HolderPct: top,
    raw,
  };
}

export function normalizeSolana(r: Raw, exclude: string[] = [], extra: SecurityCheck[] = []): SecurityReport {
  const transferFee = r.transfer_fee as Record<string, unknown> | undefined;
  const hasFee = transferFee && typeof transferFee === "object" ? Object.keys(transferFee).length > 0 : null;
  const hooks = Array.isArray(r.transfer_hook) ? (r.transfer_hook as unknown[]).length > 0 : null;
  const top = top10(r.holders, new Set(exclude.map((x) => x.toLowerCase())));
  const checks: SecurityCheck[] = [
    check("mint_authority", "Mint authority", authorityActive(r.mintable), "fail", "Mint authority is active; supply can be inflated", "Mint authority revoked"),
    check("freeze_authority", "Freeze authority", authorityActive(r.freezable), "fail", "Freeze authority is active; accounts can be frozen", "Freeze authority revoked"),
    check("balance_mutable", "Balance mutable authority", authorityActive(r.balance_mutable_authority), "fail", "An authority can modify balances", "No balance-modifying authority"),
    check("closable", "Closable mint", authorityActive(r.closable), "warn", "Mint account can be closed", "Mint cannot be closed"),
    check("metadata_mutable", "Mutable metadata", authorityActive(r.metadata_mutable), "warn", "Name/symbol/image can be changed", "Metadata is immutable"),
    check("transfer_fee", "Transfer fee", hasFee, "warn", "Token-2022 transfer fee configured", "No transfer fee"),
    check("transfer_fee_upgradable", "Upgradable transfer fee", authorityActive(r.transfer_fee_upgradable), "warn", "Transfer fee can be changed", "Transfer fee cannot be changed"),
    check("transfer_hook", "Transfer hook", hooks, "warn", "Custom transfer hook program runs on every transfer", "No transfer hook"),
    check("non_transferable", "Non-transferable", flag(r.non_transferable), "fail", "Token is non-transferable", "Token is transferable"),
    concentrationCheck(top),
    { key: "honeypot", label: "Honeypot simulation", result: "unavailable", detail: "Not provided for Solana by this provider" },
    { key: "lp_lock", label: "Liquidity lock", result: "unavailable", detail: "Not provided for Solana by this provider" },
  ];
  const holderCount = Number(r.holder_count);
  return finalize(
    extra.length ? "goplus+rpc" : "goplus",
    merge(checks, extra),
    ["mint_authority", "freeze_authority", "balance_mutable", "non_transferable", ...SOLANA_CRITICAL],
    `${extra.length ? "Mint authorities and Token-2022 extensions read on-chain; holder and other checks by GoPlus." : "SPL/Token-2022 authority checks by GoPlus."} Honeypot simulation is not available for Solana; liquidity lock is read on-chain for PumpSwap and Raydium CPMM pools (other pool types are not checked); contract verification does not apply to SPL tokens.`,
    Number.isFinite(holderCount) && holderCount > 0 ? holderCount : null,
    top,
    r,
  );
}

/** GoPlus had nothing: a report from our own on-chain checks alone. */
export function ownChecksOnly(extra: SecurityCheck[]): SecurityReport {
  return finalize(
    "rpc",
    extra,
    ["mint_authority", "freeze_authority", "non_transferable", ...SOLANA_CRITICAL],
    "Mint authorities, Token-2022 extensions and LP lock read on-chain; GoPlus had no data, so holder checks are missing.",
    null,
    null,
    null,
  );
}

export function unavailableReport(reason: string): SecurityReport {
  return {
    provider: "goplus",
    checkedAt: new Date(),
    status: "unavailable",
    riskLevel: "unknown",
    checks: [],
    unavailable: ["all"],
    limitations: reason,
    holderCount: null,
    top10HolderPct: null,
    raw: null,
  };
}

export const goplus: SecurityProvider = {
  name: "goplus",
  async check(chain: ChainId, addresses: string[], context = {}) {
    const out = new Map<string, SecurityReport>();
    const headers = await authHeaders().catch(() => ({}));
    const exclude = context.excludeHolders ?? [];
    // Read the mints once for the whole batch (1 credit per 100).
    const mintChecks = await solanaMintChecks(addresses);
    const lpChecks = context.pools ? await solanaLpChecks(new Map(Object.entries(context.pools))) : new Map<string, SecurityCheck>();
    for (const a of addresses) {
      const res = await gp.get<{ code: number; message?: string; result?: Record<string, Raw> }>(`/solana/token_security?contract_addresses=${a}`, { cacheSeconds: 600, headers });
      const extra = [...(mintChecks.get(a) ?? []), ...(lpChecks.has(a) ? [lpChecks.get(a)!] : [])].filter((c) => c.result !== "unavailable");
      // A non-OK code is a provider error, not "no data": skip so the token is retried next cycle (unless our own checks ran).
      if (res.code !== 1 && !extra.length) continue;
      const r = res.code === 1 ? Object.entries(res.result ?? {}).find(([k]) => k === a)?.[1] : undefined;
      if (r) out.set(a, normalizeSolana(r, exclude, extra));
      else if (extra.length) out.set(a, ownChecksOnly(extra));
      else out.set(a, unavailableReport("Provider returned no data for this token."));
    }
    return out;
  },
};
