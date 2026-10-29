"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, cx } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface Template {
  id: string;
  name: string;
  params: Record<string, string>;
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

/**
 * Saved filter sets: one click applies a template, "Save filters" stores the filters currently in the URL, and the
 * bell turns a template into an alert (a coin that starts matching it is sent in-app and to Telegram).
 */
export function ScreenerTemplates({ templates, keys, alerts, telegram }: { templates: Template[]; keys: string[]; alerts: Record<string, string>; telegram: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = Object.fromEntries([...sp.entries()].filter(([k, v]) => keys.includes(k) && v));
  const currentQuery = query(current);
  const hasFilters = Object.keys(current).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/screener-templates", { body: { name: name.trim(), params: current } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setNaming(false);
    setName("");
    router.refresh();
  }

  async function toggleAlert(t: Template) {
    setError(null);
    const ruleId = alerts[t.id];
    const r = ruleId
      ? await apiFetch(`/api/alerts/${ruleId}`, { method: "DELETE" })
      : await apiFetch("/api/alerts", {
          body: { name: `Screener: ${t.name}`, rule_type: "screener_match", params: { template_id: t.id }, channels: telegram ? ["in_app", "telegram"] : ["in_app"], cooldown_minutes: 60 },
        });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function remove(t: Template) {
    if (!confirm(`Delete the template "${t.name}"?`)) return;
    const r = await apiFetch(`/api/screener-templates/${t.id}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-fg-faint">Templates</span>
      {templates.length === 0 && !naming && <span className="text-xs text-fg-faint">— none yet. Set filters, then save them here.</span>}
      {templates.map((t) => {
        const active = query(t.params) === currentQuery && hasFilters;
        return (
          <span key={t.id} className={cx("inline-flex h-7 items-center rounded-full border text-xs", active ? "border-up/50 bg-up/10 text-up" : "border-line-strong text-fg-muted")}>
            <Link href={`/app/screener?${query(t.params)}`} className="pl-3 pr-1.5 hover:text-fg" aria-current={active ? "true" : undefined}>
              {t.name}
            </Link>
            <button
              type="button"
              onClick={() => toggleAlert(t)}
              className={cx("px-1", alerts[t.id] ? "text-up" : "text-fg-faint hover:text-fg")}
              aria-pressed={Boolean(alerts[t.id])}
              aria-label={alerts[t.id] ? `Stop alerts for ${t.name}` : `Alert me when a coin matches ${t.name}`}
              title={alerts[t.id] ? `Alerts on${telegram ? " (Telegram)" : " (in-app)"}: click to stop` : `Notify me when a new coin matches${telegram ? " (Telegram)" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill={alerts[t.id] ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" />
              </svg>
            </button>
            <button type="button" onClick={() => remove(t)} className="pr-2.5 text-fg-faint hover:text-down" aria-label={`Delete template ${t.name}`}>
              ×
            </button>
          </span>
        );
      })}
      {naming ? (
        <form onSubmit={save} className="flex items-center gap-1.5">
          <label htmlFor="tpl-name" className="sr-only">Template name</label>
          <input id="tpl-name" className="input h-7 w-44 py-0 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fresh low caps" maxLength={60} autoFocus />
          <Button type="submit" size="sm" variant="primary" disabled={busy || !name.trim()}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!hasFilters}
          title={hasFilters ? "Save the filters you applied as a template" : "Apply some filters first"}
          onClick={() => setNaming(true)}
        >
          + Save filters
        </Button>
      )}
      {error && <span role="alert" className="text-xs text-down">{error}</span>}
    </div>
  );
}
