"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ChainBadge } from "@/components/ui";
import { apiFetch } from "@/lib/client";

interface Hit { id: string; chain: string; symbol: string; name: string; address: string }

/** Paste an address (or a symbol) and go straight to the coin's pre-buy check. */
export function CheckForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  // A link like /app/check?q=<address> runs the check straight away.
  useEffect(() => {
    if (initial) form.current?.requestSubmit();
  }, [initial]);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (v.length < 2) return;
    setBusy(true);
    setError(null);
    setHits(null);
    const r = await apiFetch<{ results: Hit[] }>(`/api/tokens/search?q=${encodeURIComponent(v)}`);
    setBusy(false);
    if (r.error) return setError(r.error);
    const results = r.data?.results ?? [];
    // An exact address match goes straight to the check.
    const exact = results.filter((h) => h.address.toLowerCase() === v.toLowerCase());
    const only = exact.length === 1 ? exact[0] : results.length === 1 ? results[0] : null;
    if (only) return router.push(`/app/token/${only.chain}/${only.id}`);
    setHits(results);
  }

  return (
    <div>
      <form ref={form} onSubmit={submit} className="flex gap-2">
        <label htmlFor="check-q" className="sr-only">Contract address or symbol</label>
        <input
          id="check-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Paste a contract address…"
          className="input h-11 flex-1 text-base"
          autoComplete="off"
          autoFocus
        />
        <Button type="submit" variant="primary" className="h-11 px-5" disabled={busy}>{busy ? "Checking…" : "Check"}</Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
      {hits && hits.length === 0 && (
        <p className="mt-3 text-sm text-fg-muted">Not found on a DEX for your plan&apos;s chains. A brand-new launchpad coin appears here once it trades.</p>
      )}
      {hits && hits.length > 1 && (
        <ul className="mt-3 divide-y divide-line border border-line">
          {hits.map((h) => (
            <li key={h.id}>
              <Link href={`/app/token/${h.chain}/${h.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-ink-750">
                <span className="font-semibold">{h.symbol}</span>
                <ChainBadge chain={h.chain} />
                <span className="truncate text-fg-faint">{h.name}</span>
                <span className="num ml-auto text-xs text-fg-faint">{h.address.slice(0, 6)}…{h.address.slice(-4)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
