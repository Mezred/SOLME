"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/**
 * Re-fetches the server-rendered page on an interval while the tab is visible.
 * Optionally listens to the signal SSE stream and refreshes immediately when new signals land.
 */
export function AutoRefresh({ seconds = 60, stream = false }: { seconds?: number; stream?: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [enabled, seconds, router]);

  useEffect(() => {
    if (!stream || !enabled || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/stream/signals");
    es.addEventListener("signals", (e) => {
      const n = Number((e as MessageEvent).data) || 0;
      if (n > 0) {
        setFresh((f) => f + n);
        router.refresh();
      }
    });
    return () => es.close();
  }, [stream, enabled, router]);

  return (
    <button
      type="button"
      onClick={() => setEnabled((e) => !e)}
      className={cx("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs", enabled ? "border-up/30 bg-up/5 text-up" : "border-line-strong text-fg-faint")}
      aria-pressed={enabled}
      title={enabled ? `Refreshing every ${seconds}s while visible` : "Auto-refresh paused"}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", enabled ? "animate-pulse-dot bg-up" : "bg-fg-faint")} aria-hidden="true" />
      {enabled ? `Auto-refresh ${seconds}s` : "Paused"}
      {fresh > 0 && <span className="num rounded bg-up/20 px-1">+{fresh}</span>}
    </button>
  );
}
