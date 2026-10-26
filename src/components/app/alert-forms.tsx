"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ChainBadge, cx, TokenAvatar } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { ALERT_LABELS, TOKEN_RULES, type AlertType } from "@/lib/alerts/rules";
import { CHAINS, CHAIN_IDS } from "@/lib/chains";

interface Hit {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  logo_url: string | null;
}

const SIGNAL_TYPES = ["momentum", "accumulation", "breakout_watch", "distribution", "high_risk"];

export function NewAlertForm({
  presetToken,
  wallets,
  allowedChannels,
  emailVerified,
  walletAlertsAllowed,
}: {
  presetToken: Hit | null;
  wallets: { id: string; label: string }[];
  allowedChannels: string[];
  emailVerified: boolean;
  walletAlertsAllowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(presetToken));
  const [type, setType] = useState<AlertType>(presetToken ? "price_change" : "signal_score");
  const [token, setToken] = useState<Hit | null>(presetToken);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [name, setName] = useState("");
  const [chain, setChain] = useState("");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [p, setP] = useState<Record<string, string>>({ price: "", window: "h1", pct: "10", direction: "either", multiple: "3", min_score: "75", min_level: "high", liqPct: "25" });
  const [types, setTypes] = useState<string[]>(["momentum", "accumulation"]);
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [cooldown, setCooldown] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await apiFetch<{ results: Hit[] }>(`/api/tokens/search?q=${encodeURIComponent(q.trim())}`);
      setHits(r.data?.results ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const needsToken = TOKEN_RULES.includes(type);

  function params(): Record<string, unknown> {
    switch (type) {
      case "price_above":
      case "price_below":
        return { price: Number(p.price) };
      case "price_change":
        return { window: p.window, pct: Number(p.pct), direction: p.direction };
      case "volume_spike":
        return { multiple: Number(p.multiple) };
      case "liquidity_drop":
        return { pct: Number(p.liqPct) };
      case "signal_score":
        return { min_score: Number(p.min_score), signal_types: types.length ? types : undefined };
      case "security_warning":
        return { min_level: p.min_level };
      case "wallet_activity":
        return {};
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/alerts", {
      body: {
        name: name || `${ALERT_LABELS[type]}${token && needsToken ? ` · ${token.symbol}` : ""}`,
        rule_type: type,
        chain: type === "signal_score" && chain ? chain : null,
        token_id: needsToken ? token?.id ?? null : null,
        wallet_id: type === "wallet_activity" ? walletId || null : null,
        params: params(),
        channels,
        cooldown_minutes: Number(cooldown),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.replace("/app/alerts");
    router.refresh();
  }

  if (!open) return <Button variant="primary" size="sm" onClick={() => setOpen(true)}>+ New alert</Button>;
  const set = (k: string) => (e: { target: { value: string } }) => setP((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (arr: string[], v: string, fn: (a: string[]) => void) => fn(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <form onSubmit={submit} className="card mb-4 w-full p-4" aria-label="New alert rule">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">New alert rule</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-fg-faint">Cancel</button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="al-type" className="label">Alert type</label>
          <select id="al-type" className="input" value={type} onChange={(e) => setType(e.target.value as AlertType)}>
            {(Object.keys(ALERT_LABELS) as AlertType[]).map((t) => (
              <option key={t} value={t} disabled={t === "wallet_activity" && !walletAlertsAllowed}>
                {ALERT_LABELS[t]}{t === "wallet_activity" && !walletAlertsAllowed ? " (Pro)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="al-name" className="label">Name (optional)</label>
          <input id="al-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label htmlFor="al-cd" className="label">Cooldown (minutes)</label>
          <input id="al-cd" className="input num" inputMode="numeric" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
        </div>
      </div>

      {needsToken && (
        <div className="mt-3">
          <span className="label">Token</span>
          {token ? (
            <div className="flex items-center gap-2 text-sm">
              <TokenAvatar symbol={token.symbol} logo={token.logo_url} size={22} /> <span className="font-semibold">{token.symbol}</span> <ChainBadge chain={token.chain} />
              <button type="button" className="text-xs text-fg-faint underline" onClick={() => setToken(null)}>change</button>
            </div>
          ) : (
            <div className="relative max-w-md">
              <input className="input" aria-label="Search token" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracked tokens" />
              {q.trim().length >= 2 && hits.length > 0 && (
                <ul className="card absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-auto p-1">
                  {hits.map((h) => (
                    <li key={h.id}><button type="button" onClick={() => { setToken(h); setHits([]); setQ(""); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ink-750"><TokenAvatar symbol={h.symbol} logo={h.logo_url} size={20} />{h.symbol}<span className="ml-auto"><ChainBadge chain={h.chain} /></span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        {(type === "price_above" || type === "price_below") && (
          <div><label htmlFor="al-price" className="label">Price ($)</label><input id="al-price" className="input num" value={p.price} onChange={set("price")} required inputMode="decimal" /></div>
        )}
        {type === "price_change" && (
          <>
            <div><label htmlFor="al-win" className="label">Window</label><select id="al-win" className="input" value={p.window} onChange={set("window")}><option value="m5">5 minutes</option><option value="h1">1 hour</option><option value="h24">24 hours</option></select></div>
            <div><label htmlFor="al-pct" className="label">Move ≥ %</label><input id="al-pct" className="input num" value={p.pct} onChange={set("pct")} inputMode="decimal" /></div>
            <div><label htmlFor="al-dir" className="label">Direction</label><select id="al-dir" className="input" value={p.direction} onChange={set("direction")}><option value="either">Either</option><option value="up">Up</option><option value="down">Down</option></select></div>
          </>
        )}
        {type === "volume_spike" && <div><label htmlFor="al-mult" className="label">1h volume ≥ × 24h avg</label><input id="al-mult" className="input num" value={p.multiple} onChange={set("multiple")} inputMode="decimal" /></div>}
        {type === "liquidity_drop" && <div><label htmlFor="al-liq" className="label">Liquidity drop ≥ % (1h)</label><input id="al-liq" className="input num" value={p.liqPct} onChange={set("liqPct")} inputMode="decimal" /></div>}
        {type === "security_warning" && (
          <div><label htmlFor="al-lvl" className="label">Minimum risk level</label><select id="al-lvl" className="input" value={p.min_level} onChange={set("min_level")}><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
        )}
        {type === "signal_score" && (
          <>
            <div><label htmlFor="al-score" className="label">Min AI score</label><input id="al-score" className="input num" value={p.min_score} onChange={set("min_score")} inputMode="numeric" /></div>
            <div><label htmlFor="al-chain" className="label">Chain</label><select id="al-chain" className="input" value={chain} onChange={(e) => setChain(e.target.value)}><option value="">All on my plan</option>{CHAIN_IDS.map((c) => <option key={c} value={c}>{CHAINS[c].name}</option>)}</select></div>
            <fieldset className="md:col-span-2"><legend className="label">Signal types</legend>
              <div className="flex flex-wrap gap-1">{SIGNAL_TYPES.map((t) => <button key={t} type="button" aria-pressed={types.includes(t)} onClick={() => toggle(types, t, setTypes)} className={cx("h-8 rounded-md border px-2.5 text-xs", types.includes(t) ? "border-up/40 bg-up/10 text-up" : "border-line-strong text-fg-muted")}>{t.replace("_", " ")}</button>)}</div>
            </fieldset>
          </>
        )}
        {type === "wallet_activity" && (
          <div className="md:col-span-2">
            <label htmlFor="al-wallet" className="label">Tracked wallet</label>
            {wallets.length ? (
              <select id="al-wallet" className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>{wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
            ) : <p className="text-sm text-fg-faint">Track a wallet in the Whale Tracker first.</p>}
          </div>
        )}
      </div>

      <fieldset className="mt-3">
        <legend className="label">Delivery channels</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {["in_app", "email", "telegram"].map((c) => {
            const allowed = allowedChannels.includes(c);
            return (
              <label key={c} className={cx("flex items-center gap-1.5", !allowed && "opacity-50")}>
                <input type="checkbox" className="accent-[#1fe08a]" disabled={!allowed || c === "in_app"} checked={channels.includes(c)} onChange={() => toggle(channels, c, setChannels)} />
                {c === "in_app" ? "In-app (always)" : c === "email" ? `Email${!emailVerified ? " (verify email first)" : ""}` : "Telegram (link in Settings)"}
                {!allowed && " · Pro"}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
      <div className="mt-4 flex justify-end"><Button type="submit" variant="primary" disabled={busy || (needsToken && !token)}>{busy ? "Saving…" : "Create alert"}</Button></div>
    </form>
  );
}

export function RuleToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  return (
    <button
      role="switch"
      aria-checked={active}
      aria-label={active ? "Pause alert" : "Resume alert"}
      onClick={async () => { await apiFetch(`/api/alerts/${id}`, { method: "PATCH", body: { is_active: !active } }); router.refresh(); }}
      className={cx("relative h-5 w-9 rounded-full transition-colors", active ? "bg-up" : "bg-ink-700")}
    >
      <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", active ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function DeleteRule({ id }: { id: string }) {
  const router = useRouter();
  const [c, setC] = useState(false);
  return c ? (
    <span className="text-xs"><button className="text-down" onClick={async () => { await apiFetch(`/api/alerts/${id}`, { method: "DELETE" }); router.refresh(); }}>Confirm</button> · <button className="text-fg-faint" onClick={() => setC(false)}>Cancel</button></span>
  ) : <button className="text-xs text-fg-faint hover:text-down" onClick={() => setC(true)}>Delete</button>;
}

export function MarkAllRead() {
  const router = useRouter();
  return <Button size="sm" onClick={async () => { await apiFetch("/api/notifications", { body: {} }); router.refresh(); }}>Mark all read</Button>;
}
