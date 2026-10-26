"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, cx, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Generic editor for a JSON settings object. Field types follow the initial value:
 * number → number input, boolean → checkbox, string[] → comma list, string/null → text, object → fieldset.
 */
export function JsonSettingsForm({ endpoint, method = "PUT", initial, title, nullableKeys = [] }: { endpoint: string; method?: "PUT" | "POST"; initial: Record<string, Json>; title?: string; nullableKeys?: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState<Record<string, Json>>(initial);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setPath = (path: string[], v: Json) =>
    setValue((prev) => {
      const next = structuredClone(prev);
      let cur = next as Record<string, Json>;
      for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, Json>;
      cur[path[path.length - 1]] = v;
      return next;
    });

  const render = (obj: Record<string, Json>, path: string[] = []) =>
    Object.entries(obj).map(([k, v]) => {
      const p = [...path, k];
      const id = `jf-${p.join("-")}`;
      const label = k.replace(/_/g, " ");
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        return (
          <fieldset key={id} className="col-span-full rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">{label}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{render(v as Record<string, Json>, p)}</div>
          </fieldset>
        );
      }
      if (typeof v === "boolean") {
        return (
          <label key={id} htmlFor={id} className="flex items-center gap-2 text-sm">
            <input id={id} type="checkbox" className="h-4 w-4 accent-[#1fe08a]" checked={v} onChange={(e) => setPath(p, e.target.checked)} />
            {label}
          </label>
        );
      }
      if (Array.isArray(v)) {
        return (
          <div key={id}>
            <label htmlFor={id} className="label">{label} (comma-separated)</label>
            <input id={id} className="input" value={(v as string[]).join(", ")} onChange={(e) => setPath(p, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </div>
        );
      }
      if (typeof v === "number") {
        return (
          <div key={id}>
            <label htmlFor={id} className="label">{label}</label>
            <input id={id} type="number" step="any" className="input num" value={Number.isFinite(v) ? v : ""} onChange={(e) => setPath(p, e.target.value === "" ? NaN : Number(e.target.value))} />
          </div>
        );
      }
      return (
        <div key={id}>
          <label htmlFor={id} className="label">{label}</label>
          <input id={id} className="input" value={v ?? ""} onChange={(e) => setPath(p, e.target.value === "" && nullableKeys.includes(k) ? null : e.target.value)} />
        </div>
      );
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch(endpoint, { method, body: value });
    setBusy(false);
    setMsg(r.ok ? { tone: "info", text: "Saved. Change recorded in the audit log." } : { tone: "down", text: r.error ?? "Failed" });
    if (r.ok) router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-4">
      {title && <h2 className="mb-3 text-sm font-semibold">{title}</h2>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{render(value)}</div>
      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="ghost" onClick={() => setValue(initial)}>Reset</Button>
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </form>
  );
}

/** A button that sends a JSON request after an inline confirmation step. */
export function AdminAction({ endpoint, method = "PATCH", body, label, confirm, variant = "secondary" }: { endpoint: string; method?: "PATCH" | "POST" | "DELETE"; body?: unknown; label: string; confirm?: string; variant?: "secondary" | "danger" | "primary" }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirm" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setStage("busy");
    const r = await apiFetch(endpoint, { method, body: body ?? {} });
    setStage("idle");
    if (!r.ok) return setErr(r.error);
    setErr(null);
    router.refresh();
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      {stage === "confirm" ? (
        <>
          <span className="text-xs text-fg-muted">{confirm}</span>
          <Button size="sm" variant={variant === "danger" ? "danger" : "primary"} onClick={go}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => setStage("idle")}>Cancel</Button>
        </>
      ) : (
        <Button size="sm" variant={variant} disabled={stage === "busy"} onClick={() => (confirm ? setStage("confirm") : go())}>{stage === "busy" ? "…" : label}</Button>
      )}
      {err && <span className={cx("text-xs text-down")}>{err}</span>}
    </span>
  );
}

export function GrantPlanForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [planId, setPlanId] = useState("pro");
  const [days, setDays] = useState("30");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await apiFetch(`/api/admin/users/${userId}`, { method: "PATCH", body: { action: "grant_plan", planId, days: Number(days) } });
        setMsg(r.ok ? "Granted (audited)." : r.error);
        if (r.ok) router.refresh();
      }}
    >
      <div><label className="label" htmlFor={`gp-${userId}`}>Grant plan</label>
        <select id={`gp-${userId}`} className="input h-8 py-0 text-sm" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="free">Free (revoke grant)</option><option value="pro">Pro</option><option value="elite">Elite</option></select></div>
      <div className="w-20"><label className="label" htmlFor={`gd-${userId}`}>Days</label><input id={`gd-${userId}`} className="input num h-8 text-sm" value={days} onChange={(e) => setDays(e.target.value)} /></div>
      <Button size="sm" type="submit">Apply</Button>
      {msg && <span className="text-xs text-fg-muted">{msg}</span>}
    </form>
  );
}

export function SupportTicketForm({ id, status, note }: { id: string; status: string; note: string | null }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [n, setN] = useState(note ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await apiFetch(`/api/admin/support/${id}`, { method: "PATCH", body: { status: s, admin_note: n || null } });
        setSaved(r.ok);
        router.refresh();
      }}
    >
      <select aria-label="Status" className="input h-8 w-28 py-0 text-sm" value={s} onChange={(e) => setS(e.target.value)}><option value="open">open</option><option value="pending">pending</option><option value="closed">closed</option></select>
      <input aria-label="Internal note" className="input h-8 flex-1 text-sm" placeholder="Internal note" value={n} onChange={(e) => setN(e.target.value)} />
      <Button size="sm" type="submit">Save</Button>
      {saved && <span className="text-xs text-up">Saved</span>}
    </form>
  );
}

export function DocumentWalletForm() {
  const router = useRouter();
  const [f, setF] = useState({ chain: "solana", address: "", label: "", classification: "fund", classification_source: "", source_url: "" });
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="card grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await apiFetch("/api/admin/wallets", { body: { ...f, source_url: f.source_url || null } });
        setMsg(r.ok ? { tone: "info", text: "Saved." } : { tone: "down", text: r.error ?? "Failed" });
        if (r.ok) router.refresh();
      }}
    >
      <div><label className="label" htmlFor="dw-chain">Chain</label><select id="dw-chain" className="input" value={f.chain} onChange={set("chain")}><option value="solana">Solana</option><option value="ethereum">Ethereum</option><option value="bsc">BNB Smart Chain</option><option value="base">Base</option></select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="dw-addr">Address</label><input id="dw-addr" className="input num" value={f.address} onChange={set("address")} required /></div>
      <div><label className="label" htmlFor="dw-label">Label</label><input id="dw-label" className="input" value={f.label} onChange={set("label")} required /></div>
      <div><label className="label" htmlFor="dw-class">Classification</label><select id="dw-class" className="input" value={f.classification} onChange={set("classification")}><option value="fund">Fund</option><option value="whale">Whale</option><option value="smart_money">Smart Money</option><option value="exchange">Exchange</option></select></div>
      <div><label className="label" htmlFor="dw-url">Source URL</label><input id="dw-url" className="input" value={f.source_url} onChange={set("source_url")} placeholder="https://…" /></div>
      <div className="sm:col-span-3"><label className="label" htmlFor="dw-src">Documented source (required)</label><input id="dw-src" className="input" value={f.classification_source} onChange={set("classification_source")} required placeholder="e.g. Fund's published treasury address (blog post, 2026-03-01)" /></div>
      <div className="sm:col-span-3"><Button type="submit" variant="primary">Save documented wallet</Button>{msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}</div>
    </form>
  );
}
