import Link from "next/link";
import { ChainBadge, DemoBadge, EmptyState, PriceChange, RiskBadge, ScoreRing, TokenAvatar } from "@/components/ui";
import type { TokenRow } from "@/lib/data/tokens";
import { formatAge, formatCompact, formatPrice, formatUsd } from "@/lib/format";
import { launchpadName } from "@/lib/launchpad/names";
import { SortTh } from "./pagination";
import type { SearchParamsRecord } from "./url";

/** Snapshots older than this are flagged on the Screener's "Updated" column. */
const STALE_MINUTES = 15;

const stale = (at: Date | null) => at !== null && Date.now() - new Date(at).getTime() > STALE_MINUTES * 60_000;

export function TokenTable({ rows, base, params, sortable = true, showAccel = false, showUpdated = false, emptyText }: { rows: TokenRow[]; base: string; params: SearchParamsRecord; sortable?: boolean; showAccel?: boolean; showUpdated?: boolean; emptyText?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyText ?? "No tokens match"} body="Tokens appear after the ingestion engine has snapshotted them. Adjust filters or wait for the next cycle." />;
  const s = { sortable, base, params };
  return (
    <>
    <TokenCards rows={rows} />
    <div className="hidden overflow-x-auto md:block">
      <table className="table-terminal">
        <thead>
          <tr>
            <th>Token</th>
            <SortTh s={s} field="score" label="Score" />
            <th className="text-right">Price</th>
            <SortTh s={s} field="change_m5" label="5m" align="right" />
            <SortTh s={s} field="change_h1" label="1h" align="right" />
            <SortTh s={s} field="change_h6" label="6h" align="right" />
            <SortTh s={s} field="change_h24" label="24h" align="right" />
            <SortTh s={s} field="liquidity" label="Liquidity" align="right" />
            <SortTh s={s} field="volume" label="Vol 24h" align="right" />
            {showAccel && <SortTh s={s} field="volume_accel" label="Vol accel" align="right" />}
            <SortTh s={s} field="mcap" label="MCap/FDV" align="right" />
            <SortTh s={s} field="txns" label="Txns 24h" align="right" />
            <th className="text-right">Holders</th>
            <th>Security</th>
            <SortTh s={s} field="age" label="Age" align="right" />
            {showUpdated && <SortTh s={s} field="updated" label="Updated" align="right" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const accel = r.volume_h1 && r.volume_h24 ? r.volume_h1 / (r.volume_h24 / 24) : null;
            const tx = r.buys_h24 !== null && r.sells_h24 !== null ? r.buys_h24 + r.sells_h24 : null;
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/token/${r.chain}/${r.id}`} className="flex min-w-[190px] items-center gap-2 hover:text-up">
                    <TokenAvatar symbol={r.symbol} logo={r.logo_url} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[110px] truncate font-semibold" title={r.symbol}>{r.symbol}</span>
                        <ChainBadge chain={r.chain} />
                        {r.is_demo && <DemoBadge />}
                        {r.launchpad && <span className="rounded border border-line-strong px-1 text-[10px] text-fg-faint" title="Launched on this launchpad">{launchpadName(r.launchpad)}</span>}
                      </div>
                      <div className="max-w-[160px] truncate text-[11px] text-fg-faint">{r.name}</div>
                    </div>
                  </Link>
                </td>
                <td><ScoreRing score={r.metadata?.last_score?.ai ?? null} size={32} /></td>
                <td className="num text-right">{formatPrice(r.price_usd)}</td>
                <td className="text-right"><PriceChange value={r.price_change_m5} /></td>
                <td className="text-right"><PriceChange value={r.price_change_h1} /></td>
                <td className="text-right"><PriceChange value={r.price_change_h6} /></td>
                <td className="text-right"><PriceChange value={r.price_change_h24} /></td>
                <td className="num text-right">{formatUsd(r.liquidity_usd)}</td>
                <td className="num text-right">{formatUsd(r.volume_h24)}</td>
                {showAccel && <td className={`num text-right ${accel !== null && accel >= 2 ? "text-up" : "text-fg-muted"}`}>{accel === null ? "—" : `${accel.toFixed(1)}×`}</td>}
                <td className="num text-right text-fg-muted">{formatUsd(r.market_cap ?? r.fdv)}</td>
                <td className="num text-right text-fg-muted">{formatCompact(tx)}</td>
                <td className="num text-right text-fg-muted">{formatCompact(r.holder_count)}</td>
                <td><RiskBadge level={r.security_risk} /></td>
                <td className="num text-right text-fg-muted">{formatAge(r.pair_created_at)}</td>
                {showUpdated && (
                  <td className={`num text-right ${stale(r.captured_at) ? "text-warn" : "text-fg-faint"}`} title={stale(r.captured_at) ? "Older snapshot: this pair is refreshed less often" : "Snapshot age"}>
                    {r.captured_at ? `${formatAge(r.captured_at)} ago` : "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Phone layout: one card per token with the numbers a trader scans first. */
function TokenCards({ rows }: { rows: TokenRow[] }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {rows.map((r) => {
        const tx = r.buys_h24 !== null && r.sells_h24 !== null ? r.buys_h24 + r.sells_h24 : null;
        return (
          <li key={r.id}>
            <Link href={`/app/token/${r.chain}/${r.id}`} className="block space-y-1.5 px-4 py-3 hover:bg-ink-850">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <TokenAvatar symbol={r.symbol} logo={r.logo_url} />
                  <span className="truncate font-semibold">{r.symbol}</span>
                  <ChainBadge chain={r.chain} />
                  {r.launchpad && <span className="rounded border border-line-strong px-1 text-[10px] text-fg-faint">{launchpadName(r.launchpad)}</span>}
                </span>
                <span className="num text-sm">{formatUsd(r.market_cap ?? r.fdv)}</span>
              </div>
              <div className="num grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] text-fg-muted">
                <span>1h <PriceChange value={r.price_change_h1} /></span>
                <span>6h <PriceChange value={r.price_change_h6} /></span>
                <span>24h <PriceChange value={r.price_change_h24} /></span>
                <span>Liq {formatUsd(r.liquidity_usd)}</span>
                <span>Vol {formatUsd(r.volume_h24)}</span>
                <span>Tx {formatCompact(tx)}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                <RiskBadge level={r.security_risk} />
                <span>age {formatAge(r.pair_created_at)}</span>
                {r.captured_at && <span className={stale(r.captured_at) ? "text-warn" : undefined}>· updated {formatAge(r.captured_at)} ago</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
