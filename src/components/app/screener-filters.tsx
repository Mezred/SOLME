"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, cx } from "@/components/ui";
import { SCREENER_PRESETS } from "@/lib/data/screener-presets";

/** Range ids that every plan can use (mirror of RANGE_FILTERS[*].free in src/lib/data/tokens.ts). */
const FREE = new Set(["Liquidity", "Mcap", "AgeHours", "Volume", "TxnsH24", "ChangeH24"]);

/** DexScreener's activity grid: rows × timeframes, each cell a min/max pair. "" = the 24h id has no suffix. */
const FRAMES = [
  { label: "24h", suffix: "H24" },
  { label: "6h", suffix: "H6" },
  { label: "1h", suffix: "H1" },
  { label: "5m", suffix: "M5" },
];
const GRID: { label: string; id: (suffix: string) => string; unit?: string }[] = [
  { label: "Txns", id: (s) => `Txns${s}` },
  { label: "Buys", id: (s) => `Buys${s}` },
  { label: "Sells", id: (s) => `Sells${s}` },
  { label: "Volume", id: (s) => (s === "H24" ? "Volume" : `Volume${s}`), unit: "$" },
  { label: "Change", id: (s) => `Change${s}`, unit: "%" },
];
const MARKET = [
  { id: "Liquidity", label: "Liquidity", unit: "$" },
  { id: "Mcap", label: "Market cap", unit: "$" },
  { id: "Fdv", label: "FDV", unit: "$" },
  { id: "AgeHours", label: "Pair age", unit: "hours" },
];
const SAFETY = [
  { key: "minDevScore", label: "Dev score ≥", hint: "Proven Devs score of the creator" },
  { key: "maxMcapLiq", label: "Mcap ÷ liquidity ≤", hint: "Lower = deeper pool for the valuation" },
  { key: "minBuyShare", label: "Buy share 1h ≥ %", hint: "Share of last-hour txns that were buys" },
  { key: "minScore", label: "Score ≥", hint: "SOLME score, 0–100" },
];
const DEXES = [
  { value: "pumpswap", label: "PumpSwap" },
  { value: "raydium", label: "Raydium" },
  { value: "meteora", label: "Meteora" },
  { value: "orca", label: "Orca" },
  { value: "pumpfun", label: "pump.fun curve" },
  { value: "launchlab", label: "LetsBonk curve" },
  { value: "meteoradbc", label: "Meteora DBC" },
];
const LAUNCHPADS = [
  { value: "pump", label: "pump.fun" },
  { value: "bonk", label: "LetsBonk" },
  { value: "none", label: "Not a launchpad" },
];
const RISKS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
  { value: "unknown", label: "Unverified" },
];

/** Query keys every plan can use; a quick scan using anything else needs Pro. */
const FREE_KEYS = new Set([
  "q", "dex", "launchpad", "profile", "boosted", "sort", "dir",
  ...[...FREE].flatMap((id) => [`min${id}`, `max${id}`]),
]);

/** Every query key this panel owns (cleared by Reset, written by Apply). */
const KEYS = [
  "q",
  ...[...MARKET.map((m) => m.id), ...GRID.flatMap((g) => FRAMES.map((f) => g.id(f.suffix)))].flatMap((id) => [`min${id}`, `max${id}`]),
  ...SAFETY.map((s) => s.key),
  "dex", "launchpad", "profile", "boosted", "scamCheck", "risk",
];

/** DexScreener-style Screener filters: one-tap scans, the everyday row, and every range on every timeframe. URL-driven. */
export function ScreenerFilters({ advancedAllowed }: { advancedAllowed: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""])));
  const hasAdvanced = KEYS.some((k) => sp.get(k) && !["q", "minLiquidity", "maxMcap", "maxAgeHours", "minVolume", "minTxnsH24", "minChangeH24"].includes(k));
  const [open, setOpen] = useState(hasAdvanced);
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const toggle = (k: string, val: string) => {
    const cur = new Set((v[k] ?? "").split(",").filter(Boolean));
    if (cur.has(val)) cur.delete(val);
    else cur.add(val);
    set(k, [...cur].join(","));
  };
  const locked = (rangeId: string) => !advancedAllowed && !FREE.has(rangeId);

  function apply(e?: FormEvent) {
    e?.preventDefault();
    const p = new URLSearchParams(sp.toString());
    for (const k of KEYS) {
      const val = v[k]?.trim();
      if (val) p.set(k, val);
      else p.delete(k);
    }
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  function reset() {
    setV(Object.fromEntries(KEYS.map((k) => [k, ""])));
    router.push(pathname);
  }

  const active = (params: Record<string, string>) => Object.entries(params).every(([k, val]) => sp.get(k) === val) && [...sp.keys()].every((k) => k in params || k === "page");
  const num = (key: string, placeholder: string, disabled = false, label?: string) => (
    <input
      aria-label={label ?? key}
      type="number"
      inputMode="decimal"
      value={v[key] ?? ""}
      placeholder={disabled ? "Pro" : placeholder}
      onChange={(e) => set(key, e.target.value)}
      disabled={disabled}
      className="input h-8 w-full min-w-0 px-2 text-xs disabled:opacity-40"
    />
  );

  return (
    <div className="mb-4 space-y-3">
      {/* One-tap scans */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-faint">Quick scans</span>
        {SCREENER_PRESETS.map((s) => {
          const needsPro = !advancedAllowed && Object.keys(s.params).some((k) => !FREE_KEYS.has(k));
          return (
            <Link
              key={s.key}
              href={`${pathname}?${new URLSearchParams(s.params)}`}
              title={needsPro ? `${s.hint}. Needs Pro: on Free only part of it applies.` : s.hint}
              className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs", active(s.params) ? "border-up/50 bg-up/10 text-up" : "border-line-strong text-fg-muted hover:text-fg", needsPro && "opacity-60")}
            >
              {s.label}
              {needsPro && <span className="rounded border border-line-strong px-1 text-[9px] uppercase tracking-wide text-fg-faint">Pro</span>}
            </Link>
          );
        })}
      </div>

      <form onSubmit={apply} className="card p-3" role="search">
        {/* Everyday row */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[minmax(160px,1.4fr)_repeat(6,minmax(0,1fr))_auto] lg:items-end">
          <Field label="Search" className="col-span-2 sm:col-span-4 lg:col-span-1">
            <input aria-label="Search" value={v.q} onChange={(e) => set("q", e.target.value)} placeholder="Symbol, name, contract" className="input h-8 w-full text-xs" />
          </Field>
          <Field label="Liquidity ≥ $">{num("minLiquidity", "10000", false, "Minimum liquidity")}</Field>
          <Field label="Mcap ≤ $">{num("maxMcap", "500000", false, "Maximum market cap")}</Field>
          <Field label="Age ≤ h">{num("maxAgeHours", "24", false, "Maximum pair age in hours")}</Field>
          <Field label="24h vol ≥ $">{num("minVolume", "50000", false, "Minimum 24h volume")}</Field>
          <Field label="24h txns ≥">{num("minTxnsH24", "500", false, "Minimum 24h transactions")}</Field>
          <Field label="24h % ≥">{num("minChangeH24", "0", false, "Minimum 24h change")}</Field>
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-4 lg:col-span-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? "Fewer" : "All"} filters
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>Reset</Button>
            <Button type="submit" size="sm" variant="primary">Apply</Button>
          </div>
        </div>

        {open && (
          <div className="mt-4 grid gap-5 border-t border-line pt-4 xl:grid-cols-[1fr_1.6fr]">
            <div className="space-y-5">
              <Section title="Market">
                <div className="grid grid-cols-[110px_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
                  <span />
                  <span className="text-fg-faint">Min</span>
                  <span className="text-fg-faint">Max</span>
                  {MARKET.map((m) => (
                    <Row key={m.id} label={`${m.label}${m.unit === "$" ? " $" : m.unit === "hours" ? " (h)" : ""}`}>
                      {num(`min${m.id}`, "", locked(m.id), `${m.label} min`)}
                      {num(`max${m.id}`, "", locked(m.id), `${m.label} max`)}
                    </Row>
                  ))}
                </div>
              </Section>

              <Section title="Pair">
                <Chips label="DEX" options={DEXES} selected={v.dex} onToggle={(x) => toggle("dex", x)} />
                <Chips label="Launchpad" options={LAUNCHPADS} selected={v.launchpad} onToggle={(x) => toggle("launchpad", x)} />
                <div className="flex flex-wrap gap-3 text-xs">
                  <Check label="Has profile (website or socials)" checked={v.profile === "1"} onChange={(c) => set("profile", c ? "1" : "")} />
                  <Check label="Boosted only" checked={v.boosted === "1"} onChange={(c) => set("boosted", c ? "1" : "")} />
                </div>
              </Section>
            </div>

            <div className="space-y-5">
              <Section title="Activity" note={!advancedAllowed ? "6h, 1h, 5m, buys and sells are Pro" : undefined}>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[560px] grid-cols-[72px_repeat(4,minmax(0,1fr))] items-center gap-x-2 gap-y-1.5 text-xs">
                    <span />
                    {FRAMES.map((f) => <span key={f.label} className="text-center text-fg-faint">{f.label} · min / max</span>)}
                    {GRID.map((g) => (
                      <Row key={g.label} label={`${g.label}${g.unit ? ` ${g.unit}` : ""}`}>
                        {FRAMES.map((f) => {
                          const id = g.id(f.suffix);
                          return (
                            <div key={id} className="grid grid-cols-2 gap-1">
                              {num(`min${id}`, "min", locked(id), `${g.label} ${f.label} min`)}
                              {num(`max${id}`, "max", locked(id), `${g.label} ${f.label} max`)}
                            </div>
                          );
                        })}
                      </Row>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Safety (SOLME)" note={!advancedAllowed ? "Pro" : undefined}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SAFETY.map((s) => (
                    <Field key={s.key} label={s.label} title={s.hint}>{num(s.key, "", !advancedAllowed, s.label)}</Field>
                  ))}
                </div>
                <Chips label="Contract risk" options={RISKS} selected={v.risk} onToggle={(x) => toggle("risk", x)} disabled={!advancedAllowed} />
                <Check label="Passed scam check only" checked={v.scamCheck === "passed"} onChange={(c) => set("scamCheck", c ? "passed" : "")} disabled={!advancedAllowed} />
              </Section>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children, className, title }: { label: string; children: ReactNode; className?: string; title?: string }) {
  return (
    <label className={cx("block min-w-0", className)} title={title}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-fg-muted">{label}</span>
      {children}
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
        {note && <span className="rounded border border-line-strong px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-fg-faint">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Chips({ label, options, selected, onToggle, disabled }: { label: string; options: { value: string; label: string }[]; selected: string; onToggle: (v: string) => void; disabled?: boolean }) {
  const on = new Set((selected ?? "").split(",").filter(Boolean));
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            aria-pressed={on.has(o.value)}
            className={cx("h-7 rounded-md border px-2.5 text-xs disabled:opacity-40", on.has(o.value) ? "border-up/40 bg-up/10 text-up" : "border-line-strong text-fg-muted hover:text-fg")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (c: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex items-center gap-2 text-xs", disabled && "opacity-40")}>
      <input type="checkbox" className="h-4 w-4 accent-up" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
