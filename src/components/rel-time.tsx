"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

/** Relative time for client components: tolerates server/client clock drift and refreshes every 30s. */
export function RelTime({ at }: { at: string | Date | null | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time suppressHydrationWarning dateTime={at ? new Date(at).toISOString() : undefined}>
      {timeAgo(at)}
    </time>
  );
}
