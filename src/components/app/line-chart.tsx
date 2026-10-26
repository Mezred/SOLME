"use client";

import { useMemo, useState } from "react";

/**
 * Single-series line chart (SVG) with crosshair + tooltip. One series → no legend; the card title names it.
 * 2px line, recessive grid, a zero baseline when the range spans zero.
 */
const FORMATS = {
  usd: (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(v).toFixed(2)}`,
  pct: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`,
};

export function LineChart({ points, height = 200, formatKind = "usd", label }: { points: { x: string; y: number }[]; height?: number; formatKind?: keyof typeof FORMATS; label: string }) {
  const format = FORMATS[formatKind];
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 12, t: 12, b: 24 };
  const geo = useMemo(() => {
    const ys = points.map((p) => p.y);
    let min = Math.min(0, ...ys);
    let max = Math.max(0, ...ys);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const sx = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
    const sy = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    const ticks = [max, (max + min) / 2, min];
    return { sx, sy, ticks, min, max };
  }, [points, H, pad.l, pad.r, pad.t, pad.b]);

  if (points.length < 2) return <p className="px-4 py-10 text-center text-sm text-fg-faint">Not enough realized trades to draw a curve yet.</p>;
  const d = points.map((p, i) => `${i ? "L" : "M"}${geo.sx(i).toFixed(1)},${geo.sy(p.y).toFixed(1)}`).join("");
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${points.length} points, latest ${format(points[points.length - 1].y)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={geo.sy(t)} y2={geo.sy(t)} stroke="#161d2f" />
            <text x={pad.l - 6} y={geo.sy(t) + 3} textAnchor="end" fontSize="10" fill="#5d667c" fontFamily="var(--font-plex-mono)">
              {format(t)}
            </text>
          </g>
        ))}
        {geo.min < 0 && geo.max > 0 && <line x1={pad.l} x2={W - pad.r} y1={geo.sy(0)} y2={geo.sy(0)} stroke="#2a3550" />}
        <path d={d} fill="none" stroke="#4d8dff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && hp && (
          <g>
            <line x1={geo.sx(hover)} x2={geo.sx(hover)} y1={pad.t} y2={H - pad.b} stroke="#2a3550" />
            <circle cx={geo.sx(hover)} cy={geo.sy(hp.y)} r="4.5" fill="#4d8dff" stroke="#0a0e18" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line-strong bg-ink-800 px-2 py-1 text-xs shadow-lg" style={{ left: `clamp(0px, calc(${(geo.sx(hover!) / W) * 100}% - 60px), calc(100% - 140px))` }}>
          <div className="text-fg-faint">{new Date(hp.x).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          <div className="num font-medium text-fg">{format(hp.y)}</div>
        </div>
      )}
    </div>
  );
}
