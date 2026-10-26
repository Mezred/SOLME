import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { formatPct, timeAgo } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-up text-ink-950 hover:bg-[#3bf0a0] font-semibold",
  secondary: "bg-ink-700 text-fg border border-line-strong hover:bg-ink-750 hover:border-fg-faint",
  ghost: "text-fg-muted hover:text-fg hover:bg-ink-750",
  danger: "bg-down/15 text-down border border-down/40 hover:bg-down/25",
  ai: "bg-ai/15 text-[#c4baff] border border-ai/40 hover:bg-ai/25",
};
const SIZES = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-[15px]" };

export function buttonClass(variant: Variant = "secondary", size: keyof typeof SIZES = "md", extra = "") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({ variant = "secondary", size = "md", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({ variant = "secondary", size = "md", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Card({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className = "" }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-fg-faint">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "up" | "down" | "warn" | "ai" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-ink-700 text-fg-muted border-line-strong",
  up: "bg-up/10 text-up border-up/30",
  down: "bg-down/10 text-down border-down/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  ai: "bg-ai/10 text-[#b9adff] border-ai/30",
  info: "bg-info/10 text-[#8db6ff] border-info/30",
};

export function Badge({ tone = "neutral", children, className = "", title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="warn" title="Synthetic demonstration data — not real market data">
      DEMO
    </Badge>
  );
}

export function ChainBadge({ chain }: { chain: string }) {
  const c = CHAINS[chain as ChainId];
  if (!c) return <Badge>{chain}</Badge>;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />
      {c.short}
    </span>
  );
}

export function PriceChange({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  const tone = value === null || value === undefined ? "text-fg-faint" : value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg-muted";
  return <span className={cx("num", tone, className)}>{formatPct(value)}</span>;
}

export function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#5d667c";
  if (score >= 75) return "#1fe08a";
  if (score >= 60) return "#8fd14f";
  if (score >= 45) return "#f4b544";
  return "#ff4d5e";
}

export function ScoreRing({ score, size = 40, label }: { score: number | null | undefined; size?: number; label?: string }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"} ${score ?? "unavailable"} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1c2436" strokeWidth="3" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={scoreTone(score)} strokeWidth="3" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" />
      </svg>
      <span className="num absolute text-[12px] font-semibold" style={{ fontSize: size < 36 ? 10 : 12 }}>
        {score ?? "—"}
      </span>
    </div>
  );
}

export function ScoreBar({ score, tone }: { score: number | null; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
      {score !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(2, score)}%`, background: tone ?? scoreTone(score) }} />}
    </div>
  );
}

const TYPE_META: Record<string, { label: string; tone: Tone }> = {
  momentum: { label: "Momentum", tone: "up" },
  accumulation: { label: "Accumulation", tone: "info" },
  breakout_watch: { label: "Breakout watch", tone: "ai" },
  distribution: { label: "Distribution", tone: "down" },
  high_risk: { label: "High risk", tone: "down" },
};

export function SignalTypeBadge({ type }: { type: string | null }) {
  if (!type) return <Badge>No signal</Badge>;
  const m = TYPE_META[type] ?? { label: type, tone: "neutral" as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function StrengthBadge({ strength }: { strength: string }) {
  const tone: Tone = strength === "strong" ? "up" : strength === "moderate" ? "info" : strength === "avoid" ? "down" : "neutral";
  return <Badge tone={tone}>{strength}</Badge>;
}

export function RiskBadge({ level }: { level: string | null | undefined }) {
  const l = level ?? "unknown";
  const tone: Tone = l === "low" ? "up" : l === "medium" ? "warn" : l === "unknown" ? "neutral" : "down";
  return (
    <Badge tone={tone} title={l === "unknown" ? "Security data unavailable — this is not a clean result" : undefined}>
      {l === "unknown" ? "Unverified" : `${l[0].toUpperCase()}${l.slice(1)} risk`}
    </Badge>
  );
}

export function TokenAvatar({ symbol, logo, size = 28 }: { symbol: string; logo?: string | null; size?: number }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element -- remote logos from many CDNs; sized and lazy-loaded
    return <img src={logo} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full bg-ink-700 object-cover" style={{ width: size, height: size }} />;
  }
  const hue = [...symbol].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-ink-950" style={{ width: size, height: size, background: `hsl(${hue} 70% 62%)` }}>
      {symbol.replace(/^d(?=[A-Z])/, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "warn" }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-faint">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 text-fg-faint">{icon ?? <ScanIcon />}</div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {body && <p className="max-w-md text-sm text-fg-faint">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", body }: { title?: string; body?: ReactNode }) {
  return (
    <div role="alert" className="card border-down/30 bg-down/5 px-4 py-6 text-center">
      <p className="text-sm font-medium text-down">{title}</p>
      {body && <p className="mt-1 text-sm text-fg-muted">{body}</p>}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "ai" | "down"; children: ReactNode; title?: string }) {
  const map = { info: "border-info/30 bg-info/5", warn: "border-warn/30 bg-warn/5", ai: "border-ai/30 bg-ai/5", down: "border-down/30 bg-down/5" };
  const tmap = { info: "text-[#8db6ff]", warn: "text-warn", ai: "text-[#b9adff]", down: "text-down" };
  return (
    <div className={cx("rounded-lg border px-3.5 py-2.5 text-sm", map[tone])}>
      {title && <div className={cx("mb-0.5 font-medium", tmap[tone])}>{title}</div>}
      <div className="text-fg-muted">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-ink-700", className)} />;
}

export function Freshness({ at, staleAfterMinutes = 15, label = "Updated" }: { at: Date | string | null | undefined; staleAfterMinutes?: number; label?: string }) {
  if (!at) return <Badge title="No data received yet">No data yet</Badge>;
  const ageMin = (Date.now() - new Date(at).getTime()) / 60_000;
  const stale = ageMin > staleAfterMinutes;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs", stale ? "text-warn" : "text-fg-faint")} title={new Date(at).toISOString()}>
      <span className={cx("h-1.5 w-1.5 rounded-full", stale ? "bg-warn" : "animate-pulse-dot bg-up")} aria-hidden="true" />
      {stale ? "Stale · " : ""}
      {label} {timeAgo(at)}
    </span>
  );
}

export function PageHeader({ title, description, actions, badge }: { title: string; description?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function UpgradeGate({ feature, plan = "Pro" }: { feature: string; plan?: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid-bg px-6 py-10 text-center">
        <Badge tone="ai">{plan}</Badge>
        <h3 className="mt-3 text-base font-semibold">{feature} is available on {plan}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">Access is checked on the server against your active subscription.</p>
        <ButtonLink href="/app/billing" variant="primary" className="mt-4">
          View plans
        </ButtonLink>
      </div>
    </Card>
  );
}

export function ScanIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
      <path d="M7 15l3-4 3 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={cx("text-xs leading-relaxed text-fg-faint", className)}>
      Crypto assets are highly volatile and can lose all value. NEXALPHA signals, scores and AI output are informational research tools — not
      financial advice and not a guarantee of any outcome. Data may be delayed, incomplete or unavailable.{" "}
      <Link href="/risk" className="underline hover:text-fg-muted">
        Risk disclosure
      </Link>
    </p>
  );
}
