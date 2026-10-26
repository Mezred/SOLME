"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ChainBadge, TokenAvatar } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { CHAINS, CHAIN_IDS } from "@/lib/chains";

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

interface Hit {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  logo_url: string | null;
}

export function AddPositionForm({ portfolioId, preset }: { portfolioId: string; preset?: { tokenId: string; symbol: string; chain: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(preset));
  const [token, setToken] = useState<Hit | null>(preset ? { id: preset.tokenId, symbol: preset.symbol, chain: preset.chain, name: "", logo_url: null } : null);
  const [manual, setManual] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [f, setF] = useState({ chain: "solana", address: "", symbol: "", quantity: "", price: "", fee: "0", at: nowLocal(), stop: "", tp1: "", tp2: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await apiFetch<{ results: Hit[] }>(`/api/tokens/search?q=${encodeURIComponent(q.trim())}`);
      setHits(r.data?.results ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const tps = [num(f.tp1), num(f.tp2)].filter((x): x is number => x !== undefined).map((price) => ({ price }));
    const r = await apiFetch("/api/positions", {
      body: {
        portfolioId,
        ...(token && !manual ? { tokenId: token.id } : { chain: f.chain, tokenAddress: f.address, tokenSymbol: f.symbol }),
        entry: { quantity: num(f.quantity), price: num(f.price), fee: num(f.fee) ?? 0, executedAt: new Date(f.at).toISOString() },
        stopLoss: num(f.stop) ?? null,
        takeProfits: tps,
        notes: f.notes || null,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setToken(null);
    setF((s) => ({ ...s, quantity: "", price: "", stop: "", tp1: "", tp2: "", notes: "" }));
    router.refresh();
  }

  if (!open) return <Button variant="primary" size="sm" onClick={() => setOpen(true)}>+ Record position</Button>;

  return (
    <form onSubmit={submit} className="card w-full p-4" aria-label="Record a manual position">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Record a manual position</h3>
        <button type="button" className="text-xs text-fg-faint" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="mb-3 text-xs text-fg-faint">Positions are user-reported for tracking only. NEXALPHA never connects to wallets or exchanges.</p>
      {!manual ? (
        <div className="mb-3">
          {token ? (
            <div className="flex items-center gap-2 text-sm">
              <TokenAvatar symbol={token.symbol} logo={token.logo_url} size={22} />
              <span className="font-semibold">{token.symbol}</span>
              <ChainBadge chain={token.chain} />
              <button type="button" className="text-xs text-fg-faint underline" onClick={() => setToken(null)}>change</button>
            </div>
          ) : (
            <div className="relative">
              <label htmlFor="pos-token" className="label">Token</label>
              <input id="pos-token" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracked tokens or paste an address" autoComplete="off" />
              {q.trim().length >= 2 && hits.length > 0 && (
                <ul className="card absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-auto p-1">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => { setToken(h); setHits([]); setQ(""); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ink-750">
                        <TokenAvatar symbol={h.symbol} logo={h.logo_url} size={20} /> {h.symbol} <span className="text-fg-faint">{h.name}</span> <span className="ml-auto"><ChainBadge chain={h.chain} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button type="button" onClick={() => setManual(true)} className="mt-1.5 text-xs text-fg-faint underline">Token not tracked? Enter it manually</button>
        </div>
      ) : (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="pos-chain" className="label">Chain</label>
            <select id="pos-chain" className="input" value={f.chain} onChange={set("chain")}>
              {CHAIN_IDS.map((c) => <option key={c} value={c}>{CHAINS[c].name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pos-addr" className="label">Contract address</label>
            <input id="pos-addr" className="input" value={f.address} onChange={set("address")} required />
          </div>
          <div>
            <label htmlFor="pos-sym" className="label">Symbol</label>
            <input id="pos-sym" className="input" value={f.symbol} onChange={set("symbol")} required maxLength={32} />
          </div>
          <button type="button" onClick={() => setManual(false)} className="text-left text-xs text-fg-faint underline sm:col-span-3">Search tracked tokens instead</button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label htmlFor="pos-qty" className="label">Quantity</label><input id="pos-qty" className="input num" inputMode="decimal" value={f.quantity} onChange={set("quantity")} required /></div>
        <div><label htmlFor="pos-price" className="label">Entry price ($)</label><input id="pos-price" className="input num" inputMode="decimal" value={f.price} onChange={set("price")} required /></div>
        <div><label htmlFor="pos-fee" className="label">Fees ($)</label><input id="pos-fee" className="input num" inputMode="decimal" value={f.fee} onChange={set("fee")} /></div>
        <div><label htmlFor="pos-at" className="label">Executed at</label><input id="pos-at" type="datetime-local" className="input" value={f.at} onChange={set("at")} required /></div>
        <div><label htmlFor="pos-stop" className="label">Stop loss ($)</label><input id="pos-stop" className="input num" inputMode="decimal" value={f.stop} onChange={set("stop")} /></div>
        <div><label htmlFor="pos-tp1" className="label">Take profit 1 ($)</label><input id="pos-tp1" className="input num" inputMode="decimal" value={f.tp1} onChange={set("tp1")} /></div>
        <div><label htmlFor="pos-tp2" className="label">Take profit 2 ($)</label><input id="pos-tp2" className="input num" inputMode="decimal" value={f.tp2} onChange={set("tp2")} /></div>
        <div><label htmlFor="pos-notes" className="label">Journal note</label><input id="pos-notes" className="input" value={f.notes} onChange={set("notes")} maxLength={2000} /></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || (!manual && !token)}>{busy ? "Saving…" : "Save position"}</Button>
      </div>
    </form>
  );
}

export function TradeForm({ positionId, onDone }: { positionId: string; onDone?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ side: "sell", quantity: "", price: "", fee: "0", at: nowLocal(), note: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await apiFetch(`/api/positions/${positionId}/trades`, {
      body: { side: f.side, quantity: num(f.quantity), price: num(f.price), fee: num(f.fee) ?? 0, executedAt: new Date(f.at).toISOString(), note: f.note || null },
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    setF((s) => ({ ...s, quantity: "", price: "", note: "" }));
    onDone?.();
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor={`side-${positionId}`}>Side</label>
        <select id={`side-${positionId}`} className="input h-8 py-0 text-sm" value={f.side} onChange={set("side")}><option value="sell">Sell (exit)</option><option value="buy">Buy (add)</option></select></div>
      <div className="w-28"><label className="label" htmlFor={`q-${positionId}`}>Quantity</label><input id={`q-${positionId}`} className="input num h-8 text-sm" value={f.quantity} onChange={set("quantity")} required inputMode="decimal" /></div>
      <div className="w-28"><label className="label" htmlFor={`p-${positionId}`}>Price $</label><input id={`p-${positionId}`} className="input num h-8 text-sm" value={f.price} onChange={set("price")} required inputMode="decimal" /></div>
      <div className="w-20"><label className="label" htmlFor={`f-${positionId}`}>Fee $</label><input id={`f-${positionId}`} className="input num h-8 text-sm" value={f.fee} onChange={set("fee")} inputMode="decimal" /></div>
      <div><label className="label" htmlFor={`t-${positionId}`}>Time</label><input id={`t-${positionId}`} type="datetime-local" className="input h-8 text-sm" value={f.at} onChange={set("at")} required /></div>
      <div className="w-40"><label className="label" htmlFor={`n-${positionId}`}>Note</label><input id={`n-${positionId}`} className="input h-8 text-sm" value={f.note} onChange={set("note")} /></div>
      <Button size="sm" type="submit">Add trade</Button>
      {error && <span role="alert" className="w-full text-xs text-down">{error}</span>}
    </form>
  );
}

export function DeleteTrade({ positionId, tradeId }: { positionId: string; tradeId: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <button className="text-xs text-fg-faint hover:text-down" onClick={async () => {
        const r = await apiFetch(`/api/positions/${positionId}/trades?tradeId=${tradeId}`, { method: "DELETE" });
        if (!r.ok) return setErr(r.error);
        router.refresh();
      }}>Delete</button>
      {err && <span className="ml-2 text-xs text-down">{err}</span>}
    </span>
  );
}

export function NewPortfolio() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="flex items-center gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const r = await apiFetch<{ id: string }>("/api/portfolios", { body: { name } });
      if (!r.ok) return setErr(r.error);
      setName("");
      router.push(`/app/portfolio?p=${r.data!.id}`);
      router.refresh();
    }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New portfolio" aria-label="New portfolio name" className="input h-8 w-40 text-sm" required maxLength={60} />
      <Button size="sm" type="submit">Create</Button>
      {err && <span className="text-xs text-down">{err}</span>}
    </form>
  );
}
