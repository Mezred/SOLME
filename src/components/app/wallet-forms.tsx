"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { CHAINS, type ChainId } from "@/lib/chains";

export function TrackWalletForm({ chains }: { chains: ChainId[] }) {
  const router = useRouter();
  const [chain, setChain] = useState<ChainId>(chains[0] ?? "solana");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch("/api/wallets", { body: { chain, address, label: label || undefined } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setAddress("");
    setLabel("");
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-3" aria-label="Track a wallet">
      <div>
        <label htmlFor="w-chain" className="label">Chain</label>
        <select id="w-chain" className="input h-9" value={chain} onChange={(e) => setChain(e.target.value as ChainId)}>
          {chains.map((c) => <option key={c} value={c}>{CHAINS[c].name}</option>)}
        </select>
      </div>
      <div className="min-w-[280px] flex-1">
        <label htmlFor="w-addr" className="label">Wallet address</label>
        <input id="w-addr" className="input num h-9" value={address} onChange={(e) => setAddress(e.target.value)} required placeholder={chain === "solana" ? "Base58 address" : "0x…"} />
      </div>
      <div className="w-48">
        <label htmlFor="w-label" className="label">Your label (private)</label>
        <input id="w-label" className="input h-9" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </div>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? "Adding…" : "Track wallet"}</Button>
      {error && <p role="alert" className="w-full text-sm text-down">{error}</p>}
    </form>
  );
}

export function UntrackWallet({ id }: { id: string }) {
  const router = useRouter();
  const [c, setC] = useState(false);
  return c ? (
    <span className="text-xs">
      <button className="text-down" onClick={async () => { await apiFetch(`/api/wallets/${id}`, { method: "DELETE" }); router.push("/app/wallets"); router.refresh(); }}>Confirm untrack</button> ·{" "}
      <button className="text-fg-faint" onClick={() => setC(false)}>Cancel</button>
    </span>
  ) : <button className="text-xs text-fg-faint hover:text-down" onClick={() => setC(true)}>Untrack</button>;
}
