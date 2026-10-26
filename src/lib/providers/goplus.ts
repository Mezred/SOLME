import { createHash } from "node:crypto";
import { CHAINS, type ChainId } from "@/lib/chains";
import { env } from "@/lib/env";
import { ProviderClient } from "./http";
import type { SecurityCheck, SecurityProvider, SecurityReport } from "./types";

/**
 * GoPlus Security token API. Docs: https://docs.gopluslabs.io/reference/api-overview
 * Works without a key at a low rate; GOPLUS_APP_KEY/SECRET raise limits.
 * Observed behaviour (verified Oct 2026): EVM accepts comma-separated batches; the Solana endpoint
 * returns only the first address of a batch, so Solana is queried one token at a time.
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

function taxCheck(key: string, label: string, v: number | null): SecurityCheck {
  if (v === null) return { key, label, result: "unavailable", detail: "Tax not determined (token may not be tradable yet)" };
  if (v >= 50) return { key, label, result: "fail", detail: `${v.toFixed(1)}% tax` };
  if (v >= 10) return { key, label, result: "warn", detail: `${v.toFixed(1)}% tax` };
  return { key, label, result: "pass", detail: `${v.toFixed(1)}% tax` };
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

export function normalizeEvm(r: Raw, exclude: string[] = []): SecurityReport {
  const ownerRenounced = typeof r.owner_address === "string" ? /^(0x0{40}|)$/i.test(r.owner_address) || /dead$/i.test(r.owner_address) : null;
  const top = top10(r.holders, new Set(exclude.map((x) => x.toLowerCase())));
  const lpHolders = Array.isArray(r.lp_holders) ? (r.lp_holders as { is_locked?: number; percent?: string }[]) : null;
  const lockedLp = lpHolders ? lpHolders.filter((h) => h.is_locked === 1).reduce((s, h) => s + (pct(h.percent) ?? 0), 0) : null;
  const checks: SecurityCheck[] = [
    check("honeypot", "Honeypot simulation", flag(r.is_honeypot), "fail", "Simulation indicates tokens cannot be sold", "Sell simulation succeeded"),
    check("buy_restriction", "Buy restriction", flag(r.cannot_buy), "fail", "Buying is restricted", "No buy restriction detected"),
    check("sell_restriction", "Sell-all restriction", flag(r.cannot_sell_all), "fail", "Holders cannot sell their full balance", "No sell-all restriction detected"),
    taxCheck("buy_tax", "Buy tax", pct(r.buy_tax)),
    taxCheck("sell_tax", "Sell tax", pct(r.sell_tax)),
    check("contract_verified", "Contract source verified", flag(r.is_open_source) === null ? null : !flag(r.is_open_source), "warn", "Source code is not verified", "Source code is verified"),
    check("upgradeable_proxy", "Upgradeable proxy", flag(r.is_proxy), "warn", "Contract is an upgradeable proxy; logic can change", "Not a proxy contract"),
    check("mintable", "Mint function", flag(r.is_mintable), "warn", "Supply can be increased", "No mint function detected"),
    check("ownership", "Ownership", ownerRenounced === null ? null : !ownerRenounced, "warn", "Contract has an active owner", "Ownership renounced"),
    check("hidden_owner", "Hidden owner", flag(r.hidden_owner), "fail", "Hidden owner mechanism detected", "No hidden owner"),
    check("take_back_ownership", "Reclaim ownership", flag(r.can_take_back_ownership), "fail", "Ownership can be reclaimed after renouncing", "Ownership cannot be reclaimed"),
    check("owner_balance_control", "Owner can modify balances", flag(r.owner_change_balance), "fail", "Owner can change holder balances", "Owner cannot change balances"),
    check("blacklist", "Blacklist function", flag(r.is_blacklisted), "warn", "Addresses can be blacklisted from trading", "No blacklist function"),
    check("pausable_transfers", "Pausable transfers", flag(r.transfer_pausable), "warn", "Transfers can be paused", "Transfers cannot be paused"),
    check("slippage_modifiable", "Modifiable tax", flag(r.slippage_modifiable), "warn", "Owner can change trading tax", "Tax is not modifiable"),
    check("self_destruct", "Self-destruct", flag(r.selfdestruct), "fail", "Contract can self-destruct", "No self-destruct"),
    check("creator_honeypot_history", "Creator history", flag(r.honeypot_with_same_creator), "fail", "Creator has deployed honeypots before", "No honeypots from this creator found"),
    concentrationCheck(top),
    lockedLp === null
      ? { key: "lp_lock", label: "Liquidity lock", result: "unavailable", detail: "LP holder data not available" }
      : { key: "lp_lock", label: "Liquidity lock", result: lockedLp >= 80 ? "pass" : lockedLp >= 30 ? "warn" : "fail", detail: `${lockedLp.toFixed(1)}% of LP tokens locked` },
  ];
  const holderCount = Number(r.holder_count);
  return finalize(
    "goplus",
    checks,
    ["honeypot", "sell_restriction", "owner_balance_control", "sell_tax", "hidden_owner"],
    "Static analysis and sell simulation by GoPlus. Simulations can miss time-delayed or conditional traps; liquidity lock data depends on known lockers.",
    Number.isFinite(holderCount) && holderCount > 0 ? holderCount : null,
    top,
    r,
  );
}

export function normalizeSolana(r: Raw, exclude: string[] = []): SecurityReport {
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
    "goplus",
    checks,
    ["mint_authority", "freeze_authority", "balance_mutable", "non_transferable"],
    "SPL/Token-2022 authority checks by GoPlus. Honeypot simulation and liquidity-lock status are not available for Solana from this provider; contract verification does not apply to SPL tokens.",
    Number.isFinite(holderCount) && holderCount > 0 ? holderCount : null,
    top,
    r,
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
    if (CHAINS[chain].kind === "solana") {
      for (const a of addresses) {
        const res = await gp.get<{ code: number; result?: Record<string, Raw> }>(
          `/solana/token_security?contract_addresses=${a}`,
          { cacheSeconds: 600, headers },
        );
        const r = res.result?.[a];
        out.set(a, r ? normalizeSolana(r, exclude) : unavailableReport("Provider returned no data for this token."));
      }
      return out;
    }
    for (let i = 0; i < addresses.length; i += 20) {
      const batch = addresses.slice(i, i + 20);
      const res = await gp.get<{ code: number; result?: Record<string, Raw> }>(
        `/token_security/${CHAINS[chain].goplusId}?contract_addresses=${batch.join(",")}`,
        { cacheSeconds: 600, headers },
      );
      const byLower = new Map(Object.entries(res.result ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      for (const a of batch) {
        const r = byLower.get(a.toLowerCase());
        out.set(a, r ? normalizeEvm(r, exclude) : unavailableReport("Provider returned no data for this token."));
      }
    }
    return out;
  },
};
