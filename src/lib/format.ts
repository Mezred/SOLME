/** Display formatting (client-safe). Missing values render as an em dash, never as zero. */
export const DASH = "—";

export function formatUsd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (opts.compact !== false && Math.abs(v) >= 1000) return `$${formatCompact(v)}`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 })}`;
}

export function formatCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(a < 10 ? 2 : 0)}`;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** Token prices: $0.0₄5321 for very small values (subscript = count of zeros after the decimal point). */
export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (v === 0) return "$0";
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.001) return `$${v.toFixed(6)}`;
  const s = v.toFixed(20);
  const m = /^0\.(0+)(\d{4})/.exec(s);
  if (!m) return `$${v.toPrecision(4)}`;
  const zeros = String(m[1].length).split("").map((d) => SUBSCRIPT[Number(d)]).join("");
  return `$0.0${zeros}${m[2]}`;
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const body = a >= 1000 ? formatCompact(a) : a.toFixed(digits);
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${body}%`;
}

export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function timeAgo(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return DASH;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatAge(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return DASH;
  const h = (now - new Date(d).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  if (h < 24 * 60) return `${Math.round(h / 24)}d`;
  return `${(h / 24 / 365).toFixed(1)}y`;
}

export function shortAddress(a: string | null | undefined, n = 4): string {
  if (!a) return DASH;
  return a.length <= n * 2 + 3 ? a : `${a.slice(0, n + (a.startsWith("0x") ? 2 : 0))}…${a.slice(-n)}`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return DASH;
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

export function formatCents(cents: number, currency = "usd"): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 });
}
