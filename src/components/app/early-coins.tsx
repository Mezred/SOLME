import Link from "next/link";
import { Badge, ChainBadge, cx, PriceChange, TokenAvatar } from "@/components/ui";
import type { EarlyCoin } from "@/lib/early/feed";
import type { EarlyClass } from "@/lib/early/signals";
import { formatUsd, timeAgo } from "@/lib/format";
import { launchpadName } from "@/lib/launchpad/names";

export const CLASS_META: Record<EarlyClass, { label: string; icon: string; cls: string; hint: string }> = {
  building: { label: "Building Momentum", icon: "▲", cls: "border-pos/40 bg-pos/10 text-pos", hint: "Several independent signals are strengthening: rising activity, plus smart wallets buying or a proven dev." },
  early: { label: "Early Activity", icon: "●", cls: "border-up/40 bg-up/10 text-up", hint: "Trading activity is picking up against the coin's own recent pace." },
  high_risk: { label: "High Risk", icon: "⚠", cls: "border-down/50 bg-down/10 text-down", hint: "Active, but with a critical finding or deteriorating conditions. Read the risk before anything else." },
};

export function ClassBadge({ cls }: { cls: EarlyClass }) {
  const m = CLASS_META[cls];
  return (
    <span title={m.hint} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  );
}

const ageText = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

const CHECK = {
  ok: { icon: "✓", text: "Contract scan: no critical issue", cls: "text-pos" },
  risk: { icon: "✗", text: "Contract or launch scan found a risk", cls: "text-down" },
  unchecked: { icon: "?", text: "Contract not scanned yet", cls: "text-fg-faint" },
} as const;

/** One coin in the Early Coins feed: what it is, why it is here, its risk status, and where to look next. */
export function EarlyCard({ c }: { c: EarlyCoin }) {
  const check = CHECK[c.check];
  const critical = c.flags.filter((f) => f.level === "critical");
  const caution = c.flags.filter((f) => f.level === "caution" && f.key !== "unchecked");
  return (
    <li className={cx("card flex flex-col", c.cls === "high_risk" && "border-down/40")}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <TokenAvatar symbol={c.symbol} logo={c.logoUrl} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/app/token/${c.chain}/${c.id}`} className="truncate text-base font-semibold hover:text-up">{c.symbol}</Link>
            <ChainBadge chain={c.chain} />
            {c.pool && <Badge>{launchpadName(c.pool)}</Badge>}
          </div>
          <div className="truncate text-xs text-fg-faint">{c.name} · {c.ageHours !== null ? `${ageText(c.ageHours)} old` : "age unknown"}</div>
        </div>
        <ClassBadge cls={c.cls!} />
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 px-4 text-xs">
        <div><dt className="text-fg-faint" title="Price × circulating supply">Mcap</dt><dd className="num text-fg">{formatUsd(c.marketCapUsd)}</dd></div>
        <div><dt className="text-fg-faint" title="Money in the trading pool: what you can sell into">Liquidity</dt><dd className="num text-fg">{formatUsd(c.liquidityUsd)}</dd></div>
        <div><dt className="text-fg-faint">1h</dt><dd><PriceChange value={c.change.h1} /></dd></div>
        <div><dt className="text-fg-faint">Vol 1h</dt><dd className="num text-fg">{formatUsd(c.volumeH1)}</dd></div>
      </dl>

      <div className="mt-3 px-4 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Why it&apos;s here</div>
        <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
          {c.signals.map((s) => (
            <li key={s.key} className="flex gap-1.5"><span className="text-pos" aria-hidden="true">+</span>{s.text}</li>
          ))}
        </ul>
        {(critical.length > 0 || caution.length > 0) && (
          <ul className="mt-2 space-y-0.5 text-xs">
            {critical.map((f) => <li key={f.key + f.text} className="flex gap-1.5 text-down"><span aria-hidden="true">✗</span>{f.text}</li>)}
            {caution.map((f) => <li key={f.key + f.text} className="flex gap-1.5 text-warn"><span aria-hidden="true">!</span>{f.text}</li>)}
          </ul>
        )}
      </div>

      <div className="mt-auto border-t border-line px-4 py-2.5 pt-2.5 text-xs">
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={cx("flex items-center gap-1.5", check.cls)}><span aria-hidden="true" className="font-bold">{check.icon}</span>{check.text}</span>
          <Link href={`/app/token/${c.chain}/${c.id}`} className="shrink-0 text-up hover:underline" title="The full check: sell test, holders, insiders, trading">Full Coin Check →</Link>
        </div>
        <div className="mt-1 text-[11px] text-fg-faint">
          Updated {timeAgo(c.updatedAt)} · {c.missing.length ? `partial data: no ${c.missing.join(", no ")}` : "data complete"}
        </div>
      </div>
    </li>
  );
}
