import Link from "next/link";
import { CopyAddress } from "@/components/app/token-actions";
import { cx } from "@/components/ui";
import type { LaunchRow } from "@/lib/data/launchpad";
import { formatAge, formatUsd } from "@/lib/format";
import { GMGN_DISCLOSURE, gmgnTradeUrl } from "@/lib/gmgn";
import { launchpadName, launchpadUrl } from "@/lib/launchpad/names";
import { launchReadout, type LaunchStatus } from "@/lib/launchpad/readout";

export const STATUS: Record<LaunchStatus, { icon: string; label: string; chip: string; edge: string }> = {
  clear: { icon: "✓", label: "Looks clear", chip: "border-pos/50 bg-pos/10 text-pos", edge: "border-l-pos" },
  caution: { icon: "!", label: "Caution", chip: "border-warn/50 bg-warn/10 text-warn", edge: "border-l-warn" },
  avoid: { icon: "✗", label: "Avoid", chip: "border-down/50 bg-down/10 text-down", edge: "border-l-down" },
  pending: { icon: "…", label: "Checking", chip: "border-line-strong text-fg-muted", edge: "border-l-line-strong" },
  unchecked: { icon: "?", label: "Not checked", chip: "border-line-strong text-fg-muted", edge: "border-l-line-strong" },
};
/** A launch this fresh is marked New: the window where a proven dev's coin is still cheap. */
const NEW_MINUTES = 10;

const coinHref = (t: LaunchRow) => `/app/token/${t.chain}/${t.token_id ?? t.mint}`;

/**
 * Proven-dev launches as a scannable list: a plain verdict (Looks clear / Caution / Avoid / Checking / Not checked),
 * what is wrong (worst first) on its own lines, the neutral facts on one line, age, market cap and curve progress at a
 * glance, and every action on the row: copy the contract, trade, open the launchpad, the coin page and the developer.
 */
export function ProvenLaunchList({ rows }: { rows: LaunchRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => {
        const r = launchReadout(t);
        const s = STATUS[r.status];
        const padUrl = launchpadUrl(t.pool, t.mint);
        const gmgn = gmgnTradeUrl(t.chain, t.mint);
        return (
          <li key={t.mint} className={cx("border-l-2 px-4 py-3", s.edge)}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold", s.chip)}>
                <span aria-hidden="true">{s.icon}</span>{s.label}
              </span>
              <Link href={coinHref(t)} className="text-base font-semibold hover:text-up">{t.symbol ?? t.mint.slice(0, 6)}</Link>
              {t.name && <span className="hidden max-w-[16rem] truncate text-sm text-fg-muted sm:inline">{t.name}</span>}
              {r.ageMinutes < NEW_MINUTES && <span className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-up">New</span>}
              <span className="num text-xs text-fg-faint">{formatAge(t.created_at)} ago · {launchpadName(t.pool)}</span>
              <span className="ml-auto flex items-center gap-3">
                <Curve pct={r.curvePct} migrated={r.migrated} />
                <span className="num text-sm" title="Market cap">{formatUsd(t.market_cap_usd, { compact: true })}</span>
              </span>
            </div>

            {r.problems.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {r.problems.map((x) => (
                  <li key={x.text} className={cx("flex gap-1.5", x.level === "avoid" ? "text-down" : "text-warn")}>
                    <span aria-hidden="true">{x.level === "avoid" ? "✗" : "!"}</span>{x.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-fg-faint">
              {r.facts.map((f, i) => (
                <span key={f.text}>{i > 0 && " · "}<span className={f.good ? "text-pos" : undefined}>{f.text}</span></span>
              ))}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <CopyAddress address={t.mint} />
              {gmgn && r.status !== "avoid" && (
                <a href={gmgn} target="_blank" rel="noopener noreferrer sponsored" title={GMGN_DISCLOSURE} className="font-semibold text-up hover:underline">Trade on GMGN ↗</a>
              )}
              {padUrl && <a href={padUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-muted hover:text-fg">{launchpadName(t.pool)} ↗</a>}
              <Link href={coinHref(t)} className="text-fg-muted hover:text-fg">Coin page</Link>
              <Link href={`/app/smart-dev/${t.creator}`} className="text-fg-muted hover:text-fg">Dev profile →</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Curve({ pct, migrated }: { pct: number | null; migrated: boolean }) {
  if (migrated) return <span className="text-xs text-pos" title="Left the bonding curve for a DEX pool">Migrated</span>;
  if (pct === null) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-fg-muted" title="Bonding curve progress: at 100% the coin migrates to a DEX pool">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
        <span className="block h-full rounded-full bg-up" style={{ width: `${pct}%` }} />
      </span>
      <span className="num">curve {pct}%</span>
    </span>
  );
}
