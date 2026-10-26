"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export function WatchButton({ tokenId, watching: initial }: { tokenId: string; watching: boolean }) {
  const router = useRouter();
  const [watching, setWatching] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start">
      <Button
        variant={watching ? "secondary" : "primary"}
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = watching
            ? await apiFetch(`/api/watchlists/items?tokenId=${tokenId}`, { method: "DELETE" })
            : await apiFetch("/api/watchlists/items", { body: { tokenId } });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setWatching(!watching);
          router.refresh();
        }}
        aria-pressed={watching}
      >
        {watching ? "★ Watching" : "☆ Add to watchlist"}
      </Button>
      {error && <span className="mt-1 text-xs text-down">{error}</span>}
    </div>
  );
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="num max-w-full truncate rounded border border-line bg-ink-900 px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg"
      title="Copy contract address"
    >
      {copied ? "Copied ✓" : address}
    </button>
  );
}

export function TokenLinks({ tokenId, chain }: { tokenId: string; chain: string }) {
  return (
    <>
      <Link href={`/app/alerts?new=1&tokenId=${tokenId}`} className={buttonClass("secondary", "sm")}>
        Create alert
      </Link>
      <Link href={`/app/ai?tokenId=${tokenId}`} className={buttonClass("ai", "sm")}>
        AI analysis
      </Link>
      <Link href={`/app/portfolio?addToken=${tokenId}&chain=${chain}`} className={buttonClass("ghost", "sm")}>
        Log a trade
      </Link>
    </>
  );
}
