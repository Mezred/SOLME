"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, ChainBadge, cx, PriceChange, ScoreRing, SignalTypeBadge, TokenAvatar } from "@/components/ui";
import { formatPrice, formatUsd, timeAgo } from "@/lib/format";

export interface PreviewRow {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  logo: string | null;
  type: string;
  score: number;
  confidence: number;
  price: number | null;
  h1: number | null;
  h24: number | null;
  liquidity: number | null;
  volume: number | null;
  buys: number | null;
  sells: number | null;
  createdAt: string;
  demo: boolean;
}

const TABS = ["all", "solana", "ethereum", "bsc", "base"] as const;

export function TerminalPreview({ rows, live }: { rows: PreviewRow[]; live: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [sel, setSel] = useState<string | null>(rows[0]?.id ?? null);
  const shown = useMemo(() => rows.filter((r) => tab === "all" || r.chain === tab).slice(0, 7), [rows, tab]);
  const active = rows.find((r) => r.id === sel) ?? shown[0];

  return (
    <div className="card overflow-hidden shadow-[0_0_0_1px_rgba(31,224,138,0.04),0_30px_80px_-30px_rgba(31,224,138,0.18)]">
      <div className="flex items-center justify-between border-b border-line bg-ink-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-down/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-up/70" />
          </span>
          <span className="num text-xs text-fg-muted">nexalpha://signals</span>
        </div>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-faint">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-up" aria-hidden="true" /> Live data · 15-min delayed preview
          </span>
        ) : (
          <Badge tone="warn">Illustrative preview — not live data</Badge>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5" role="tablist" aria-label="Filter by chain">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("rounded-md px-2.5 py-1 text-xs uppercase tracking-wide", tab === t ? "bg-ink-700 text-fg" : "text-fg-faint hover:text-fg-muted")}
          >
            {t === "bsc" ? "BSC" : t}
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto">
          <table className="table-terminal">
            <thead>
              <tr>
                <th>Token</th>
                <th>Signal</th>
                <th className="text-right">Score</th>
                <th className="text-right">1h</th>
                <th className="hidden text-right sm:table-cell">Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-fg-faint">
                    No signals on this chain right now.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setSel(r.id)} className={cx("cursor-pointer", active?.id === r.id && "[&>td]:bg-ink-750")}>
                  <td>
                    <div className="flex items-center gap-2">
                      <TokenAvatar symbol={r.symbol} logo={r.logo} size={22} />
                      <span className="font-medium">{r.symbol}</span>
                      <ChainBadge chain={r.chain} />
                    </div>
                  </td>
                  <td>
                    <SignalTypeBadge type={r.type} />
                  </td>
                  <td className="num text-right font-semibold">{r.score}</td>
                  <td className="text-right">
                    <PriceChange value={r.h1} />
                  </td>
                  <td className="num hidden text-right text-fg-muted sm:table-cell">{formatUsd(r.liquidity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {active && (
          <aside className="border-t border-line bg-ink-900/60 p-4 md:border-l md:border-t-0" aria-label="Signal detail">
            <div className="flex items-center gap-3">
              <ScoreRing score={active.score} size={46} />
              <div>
                <div className="font-semibold">{active.symbol}</div>
                <div className="text-xs text-fg-faint">{timeAgo(active.createdAt)}</div>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <Row k="Price" v={<span className="num">{formatPrice(active.price)}</span>} />
              <Row k="24h" v={<PriceChange value={active.h24} />} />
              <Row k="Volume 24h" v={<span className="num">{formatUsd(active.volume)}</span>} />
              <Row k="Buys / sells 1h" v={<span className="num">{active.buys ?? "—"} / {active.sells ?? "—"}</span>} />
              <Row k="Confidence" v={<span className="num">{active.confidence}/100</span>} />
            </dl>
            <Link href="/signup" className="mt-4 block rounded-lg border border-ai/40 bg-ai/10 px-3 py-2 text-center text-xs text-[#c4baff] hover:bg-ai/20">
              See factor breakdown & AI explanation →
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fg-faint">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
