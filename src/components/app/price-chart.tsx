"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, cx } from "@/components/ui";
import { formatPrice } from "@/lib/format";

interface CandleResp {
  source: string;
  demo: boolean;
  degraded?: string;
  candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  line?: { time: number; value: number }[];
}

const TFS = ["15m", "1h", "4h", "1d"] as const;

/** Lightweight Charts throws unless times are strictly ascending, so sort and drop repeated timestamps. */
function ascUnique<T extends { time: number }>(points: T[]): T[] {
  return [...points].sort((a, b) => a.time - b.time).filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time);
}

/** Candlestick chart (TradingView Lightweight Charts) with volume, plus optional price level overlays. */
export function PriceChart({ tokenId, levels }: { tokenId: string; levels?: { price: number; label: string; color: string }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<(typeof TFS)[number]>("15m");
  const [state, setState] = useState<{ loading: boolean; error: string | null; meta: CandleResp | null }>({ loading: true, error: null, meta: null });

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const res = await fetch(`/api/tokens/${tokenId}/candles?tf=${tf}`).catch(() => null);
      const data: CandleResp | null = res && res.ok ? await res.json().catch(() => null) : null;
      if (disposed) return;
      if (!data) return setState({ loading: false, error: "Chart data unavailable right now.", meta: null });
      if (!el.current) return;
      const { createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !el.current) return;
      // The chart draws on a canvas, so theme colors are read from the CSS tokens at render time.
      const css = getComputedStyle(document.documentElement);
      const tok = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
      const [up, down, line, muted] = [tok("up"), tok("down"), tok("line"), tok("fg-muted")];
      const chart = createChart(el.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: muted, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: false },
        grid: { vertLines: { color: line }, horzLines: { color: line } },
        rightPriceScale: { borderColor: line },
        timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal },
        localization: { priceFormatter: (p: number) => formatPrice(p).replace("$", "") },
      });
      if (data.candles) data.candles = ascUnique(data.candles);
      if (data.line) data.line = ascUnique(data.line);
      if (data.candles?.length) {
        const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat: { type: "price", minMove: 1e-12, precision: 10 } });
        candles.setData(data.candles.map((c) => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })));
        const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(data.candles.map((c) => ({ time: c.time as never, value: c.volume, color: `${c.close >= c.open ? up : down}59` })));
        for (const l of levels ?? []) candles.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.label });
      } else if (data.line?.length) {
        const series = chart.addSeries(LineSeries, { color: up, lineWidth: 2, priceFormat: { type: "price", minMove: 1e-12, precision: 10 } });
        series.setData(data.line.map((p) => ({ time: p.time as never, value: p.value })));
      }
      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
      setState({ loading: false, error: data.candles?.length || data.line?.length ? null : "No price history available for this pair yet.", meta: data });
    })().catch(() => {
      // Network drop while loading the chart library or candles (e.g. server restarting): show it in the chart
      // instead of an uncaught error.
      if (!disposed) setState({ loading: false, error: "Chart failed to load. Check your connection and reload the page.", meta: null });
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [tokenId, tf, levels]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Timeframe">
          {TFS.map((t) => (
            <button key={t} role="tab" aria-selected={tf === t} onClick={() => setTf(t)} className={cx("rounded px-2 py-1 text-xs", tf === t ? "bg-ink-700 text-fg" : "text-fg-faint hover:text-fg-muted")}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-fg-faint">
          {state.meta?.demo && <Badge tone="warn">Synthetic demo candles</Badge>}
          {state.meta?.source === "snapshots" && <Badge tone="warn" title={state.meta.degraded}>OHLCV unavailable · showing SOLME snapshots</Badge>}
          {state.meta?.source === "geckoterminal" && <span>OHLCV: GeckoTerminal</span>}
        </div>
      </div>
      <div className="relative h-[340px]">
        <div ref={el} className="absolute inset-0" />
        {state.loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-fg-faint">Loading chart…</div>}
        {!state.loading && state.error && <div className="absolute inset-0 flex items-center justify-center text-sm text-fg-faint">{state.error}</div>}
      </div>
    </div>
  );
}
