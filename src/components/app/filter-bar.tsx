"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, cx } from "@/components/ui";

export interface FilterField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "multi";
  options?: { value: string; label: string }[];
  placeholder?: string;
  advanced?: boolean;
  width?: string;
}

/** URL-driven filters: submitting navigates with query params so results are server-rendered and shareable. */
export function FilterBar({ fields, advancedAllowed = true }: { fields: FilterField[]; advancedAllowed?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, sp.get(f.name) ?? ""])));
  const [showAdvanced, setShowAdvanced] = useState(() => fields.some((f) => f.advanced && sp.get(f.name)));

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const toggleMulti = (k: string, v: string) => {
    const cur = new Set((values[k] ?? "").split(",").filter(Boolean));
    if (cur.has(v)) cur.delete(v);
    else cur.add(v);
    set(k, [...cur].join(","));
  };

  function apply(e?: FormEvent) {
    e?.preventDefault();
    const p = new URLSearchParams(sp.toString());
    for (const f of fields) {
      const v = values[f.name]?.trim();
      if (v) p.set(f.name, v);
      else p.delete(f.name);
    }
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  function reset() {
    setValues(Object.fromEntries(fields.map((f) => [f.name, ""])));
    const p = new URLSearchParams();
    for (const k of ["sort", "dir"]) if (sp.get(k)) p.set(k, sp.get(k)!);
    router.push(p.toString() ? `${pathname}?${p}` : pathname);
  }

  const basic = fields.filter((f) => !f.advanced);
  const adv = fields.filter((f) => f.advanced);

  const renderField = (f: FilterField) => {
    const id = `f-${f.name}`;
    if (f.type === "multi") {
      const selected = new Set((values[f.name] ?? "").split(",").filter(Boolean));
      return (
        <fieldset key={f.name} className="min-w-0">
          <legend className="label">{f.label}</legend>
          <div className="flex flex-wrap gap-1">
            {f.options!.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggleMulti(f.name, o.value)}
                aria-pressed={selected.has(o.value)}
                className={cx("h-8 rounded-md border px-2.5 text-xs", selected.has(o.value) ? "border-up/40 bg-up/10 text-up" : "border-line-strong text-fg-muted hover:text-fg")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
      );
    }
    return (
      <div key={f.name} className={f.width ?? "w-full sm:w-36"}>
        <label htmlFor={id} className="label">
          {f.label}
        </label>
        {f.type === "select" ? (
          <select id={id} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} className="input h-8 py-0 text-sm">
            <option value="">Any</option>
            {f.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={f.type === "number" ? "number" : "text"}
            inputMode={f.type === "number" ? "decimal" : undefined}
            value={values[f.name]}
            placeholder={f.placeholder}
            onChange={(e) => set(f.name, e.target.value)}
            className="input h-8 text-sm"
            disabled={f.advanced && !advancedAllowed}
          />
        )}
      </div>
    );
  };

  return (
    <form onSubmit={apply} className="card mb-4 p-3" role="search">
      <div className="flex flex-wrap items-end gap-3">
        {basic.map(renderField)}
        <div className="ml-auto flex gap-2">
          {adv.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced}>
              {showAdvanced ? "Hide" : "More"} filters{!advancedAllowed && " (Pro)"}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button type="submit" size="sm" variant="primary">
            Apply
          </Button>
        </div>
      </div>
      {showAdvanced && adv.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
          {adv.map(renderField)}
          {!advancedAllowed && <p className="text-xs text-warn">Advanced filters require Pro; they are ignored on your plan.</p>}
        </div>
      )}
    </form>
  );
}
