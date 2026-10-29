"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ChainBadge, cx, TokenAvatar } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { ALERT_LABELS, MANAGED_RULES, TOKEN_RULES, type AlertType } from "@/lib/alerts/rules";

interface Hit {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  logo_url: string | null;
}

export function NewAlertForm({
  presetToken,
  wallets,
  allowedChannels,
  defaultChannels = ["in_app"],
  emailVerified,
  walletAlertsAllowed,
}: {
  presetToken: Hit | null;
  wallets: { id: string; label: string }[];
  allowedChannels: string[];
  /** Pre-ticked channels: in-app, plus Telegram once it is connected. */
  defaultChannels?: string[];
  emailVerified: boolean;
  walletAlertsAllowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(presetToken));
  const [type, setType] = useState<AlertType>(presetToken ? "price_change" : "dev_deploy");
  const [token, setToken] = useState<Hit | null>(presetToken);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [name, setName] = useState("");
  // "" = every wallet the user follows.
  const [walletId, setWalletId] = useState("");
  const [walletDirs, setWalletDirs] = useState<string[]>(["buy", "sell", "transfer_out"]);
  const [walletCheck, setWalletCheck] = useState(false);
  const [earlyContractOk, setEarlyContractOk] = useState(true);
  const [p, setP] = useState<Record<string, string>>({ price: "", window: "h1", pct: "10", direction: "either", multiple: "3", min_level: "high", liqPct: "25", devScore: "60", progress: "80", curveDevScore: "40", walletScore: "60", buySol: "0.5", walletMinSol: "0", earlyClass: "building", earlyLiq: "10000", earlySmart: "0", earlyPerHour: "6", watchLiq: "30" });
  const [channels, setChannels] = useState<string[]>(defaultChannels);
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
      case "security_warning":
        return { min_level: p.min_level };
      case "wallet_activity":
        return { directions: walletDirs, min_sol: Number(p.walletMinSol) || 0, pass_check: walletCheck };
      case "dev_deploy":
        return { min_dev_score: Number(p.devScore) };
      case "curve_progress":
        return { min_progress: Number(p.progress), min_dev_score: Number(p.curveDevScore) };
      case "smart_wallet_buy":
        return { min_wallet_score: Number(p.walletScore), min_buy_sol: Number(p.buySol) };
      case "screener_match": // switched on from the Screener, not this form
      case "smart_group_buy": // switched on as a preset on the Alerts page
        return {};
      case "early_coin":
        return {
          min_class: p.earlyClass,
          contract_ok: earlyContractOk,
          min_liquidity: Number(p.earlyLiq) || 0,
          min_smart_wallets: Number(p.earlySmart) || 0,
          max_per_hour: Number(p.earlyPerHour) || undefined,
        };
      case "watchlist_risk":
        return { liquidity_drop_pct: Number(p.watchLiq) };
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
        chain: null,
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
            {(Object.keys(ALERT_LABELS) as AlertType[]).filter((t) => !MANAGED_RULES.includes(t)).map((t) => (
              <option key={t} value={t} disabled={(t === "wallet_activity" || t === "smart_wallet_buy") && !walletAlertsAllowed}>
                {ALERT_LABELS[t]}{(t === "wallet_activity" || t === "smart_wallet_buy") && !walletAlertsAllowed ? " (Pro)" : ""}
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
        {type === "early_coin" && (
          <>
            <div><label htmlFor="al-ecls" className="label">When a coin is</label><select id="al-ecls" className="input" value={p.earlyClass} onChange={set("earlyClass")}><option value="building">Building Momentum</option><option value="early">Early Activity or better</option></select></div>
            <div><label htmlFor="al-eliq" className="label">Min liquidity ($)</label><input id="al-eliq" className="input num" value={p.earlyLiq} onChange={set("earlyLiq")} inputMode="numeric" /></div>
            <div><label htmlFor="al-esm" className="label">Min smart wallets bought</label><input id="al-esm" className="input num" value={p.earlySmart} onChange={set("earlySmart")} inputMode="numeric" /></div>
            <div><label htmlFor="al-eph" className="label">At most alerts per hour</label><input id="al-eph" className="input num" value={p.earlyPerHour} onChange={set("earlyPerHour")} inputMode="numeric" /></div>
            <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={earlyContractOk} onChange={(e) => setEarlyContractOk(e.target.checked)} /> Only coins whose contract was checked with no critical issue</label>
            <p className="text-xs text-fg-faint md:col-span-4">Each coin alerts once per class. Coins already in Early Coins when you create the rule are skipped. Building Momentum alerts need Pro.</p>
          </>
        )}
        {type === "watchlist_risk" && (
          <div className="md:col-span-4">
            <label htmlFor="al-wliq" className="label">Liquidity drop ≥ % within ~1h (10–95)</label>
            <input id="al-wliq" className="input num max-w-[160px]" value={p.watchLiq} onChange={set("watchLiq")} inputMode="numeric" />
            <p className="mt-1 text-xs text-fg-faint">For every coin on your watchlist. Also fires when SOLME&apos;s background re-run of the full risk check (about every 30 minutes) finds the risk rising to High or Critical.</p>
          </div>
        )}
        {type === "volume_spike" && <div><label htmlFor="al-mult" className="label">1h volume ≥ × 24h avg</label><input id="al-mult" className="input num" value={p.multiple} onChange={set("multiple")} inputMode="decimal" /></div>}
        {type === "liquidity_drop" && <div><label htmlFor="al-liq" className="label">Liquidity drop ≥ % (1h)</label><input id="al-liq" className="input num" value={p.liqPct} onChange={set("liqPct")} inputMode="decimal" /></div>}
        {type === "security_warning" && (
          <div><label htmlFor="al-lvl" className="label">Minimum risk level</label><select id="al-lvl" className="input" value={p.min_level} onChange={set("min_level")}><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
        )}
        {type === "dev_deploy" && (
          <div className="md:col-span-3">
            <label htmlFor="al-dev" className="label">Min dev score at launch (1–100)</label>
            <input id="al-dev" className="input num max-w-[160px]" value={p.devScore} onChange={set("devScore")} inputMode="numeric" />
            <p className="mt-1 text-xs text-fg-faint">Fires when a creator with this Smart Dev score and 2+ earlier launches launches on pump.fun or LetsBonk. 60+ means at least one earlier launch migrated.</p>
          </div>
        )}
        {type === "curve_progress" && (
          <>
            <div><label htmlFor="al-prog" className="label">Curve progress ≥ % (50–99)</label><input id="al-prog" className="input num" value={p.progress} onChange={set("progress")} inputMode="numeric" /></div>
            <div><label htmlFor="al-cdev" className="label">And dev score ≥ (0 = any dev)</label><input id="al-cdev" className="input num" value={p.curveDevScore} onChange={set("curveDevScore")} inputMode="numeric" /></div>
          </>
        )}
        {type === "smart_wallet_buy" && (
          <>
            <div><label htmlFor="al-ws" className="label">Min wallet score</label><input id="al-ws" className="input num" value={p.walletScore} onChange={set("walletScore")} inputMode="numeric" /></div>
            <div><label htmlFor="al-sol" className="label">Min buy size (SOL)</label><input id="al-sol" className="input num" value={p.buySol} onChange={set("buySol")} inputMode="decimal" /></div>
            <p className="self-end text-xs text-fg-faint md:col-span-2">Watched wallets: on-chain score 60+ and not bot-like (Smart Money candidates and scored tracked wallets).</p>
          </>
        )}
        {type === "wallet_activity" && (
          <>
            <div>
              <label htmlFor="al-wallet" className="label">Wallet</label>
              <select id="al-wallet" className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                <option value="">All wallets I follow ({wallets.length})</option>
                {wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
            <div><label htmlFor="al-wsol" className="label">Min trade size (SOL, 0 = all)</label><input id="al-wsol" className="input num" value={p.walletMinSol} onChange={set("walletMinSol")} inputMode="decimal" /></div>
            <fieldset className="md:col-span-3">
              <legend className="label">Alert on</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {([["buy", "Buys"], ["sell", "Sells"], ["transfer_out", "Tokens sent out"], ["transfer_in", "Tokens received (often spam airdrops)"]] as const).map(([d, l]) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <input type="checkbox" className="accent-up" checked={walletDirs.includes(d)} onChange={() => toggle(walletDirs, d, setWalletDirs)} /> {l}
                  </label>
                ))}
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" className="accent-up" checked={walletCheck} onChange={() => setWalletCheck(!walletCheck)} /> Only buys that pass the scam check
                </label>
              </div>
              {!wallets.length && <p className="mt-1 text-xs text-fg-faint">Follow a wallet on the Wallets page first; the alert covers every wallet you follow later too.</p>}
            </fieldset>
          </>
        )}
      </div>

      <fieldset className="mt-3">
        <legend className="label">Delivery channels</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {["in_app", "email", "telegram"].map((c) => {
            const allowed = allowedChannels.includes(c);
            return (
              <label key={c} className={cx("flex items-center gap-1.5", !allowed && "opacity-50")}>
                <input type="checkbox" className="accent-up" disabled={!allowed || c === "in_app"} checked={channels.includes(c)} onChange={() => toggle(channels, c, setChannels)} />
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

/** One-click alert preset: creates the rule the first time, then just switches it on and off. */
export function PresetSwitch({ preset, ruleId, active, channels, locked }: {
  preset: { key: string; title: string; rule_type: string; params: Record<string, unknown> };
  ruleId: string | null;
  active: boolean;
  channels: string[];
  locked: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    const r = ruleId
      ? await apiFetch(`/api/alerts/${ruleId}`, { method: "PATCH", body: { is_active: !active } })
      : await apiFetch("/api/alerts", { body: { name: preset.title.slice(0, 80), rule_type: preset.rule_type, params: { ...preset.params, preset: preset.key }, channels, cooldown_minutes: 1 } });
    setBusy(false);
    if (r.error) return setError(r.error);
    router.refresh();
  }
  if (locked) return <span className="text-xs text-fg-faint" title={locked}>{locked}</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        role="switch"
        aria-checked={active}
        aria-label={preset.title}
        disabled={busy}
        onClick={toggle}
        className={cx("relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50", active ? "border-up bg-up" : "border-line-strong bg-ink-800")}
      >
        <span className={cx("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all", active ? "left-[18px] bg-ink-950" : "left-0.5 bg-fg-faint")} />
      </button>
      {error && <span role="alert" className="max-w-[200px] text-right text-[10px] text-down">{error}</span>}
    </span>
  );
}
