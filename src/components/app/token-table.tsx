import Link from "next/link";
import { ChainBadge, DemoBadge, EmptyState, PriceChange, RiskBadge, ScoreRing, TokenAvatar } from "@/components/ui";
import type { TokenRow } from "@/lib/data/tokens";
import { formatAge, formatCompact, formatPrice, formatUsd } from "@/lib/format";
import { SortTh } from "./pagination";
import type { SearchParamsRecord } from "./url";

export function TokenTable({ rows, base, params, sortable = true, showAccel = false, emptyText }: { rows: TokenRow[]; base: string; params: SearchParamsRecord; sortable?: boolean; showAccel?: boolean; emptyText?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyText ?? "No tokens match"} body="Tokens appear after the ingestion engine has snapshotted them. Adjust filters or wait for the next cycle." />;
  const s = { sortable, base, params };
  return (
    <div className="overflow-x-auto">
      <table className="table-terminal">
        <thead>
          <tr>
            <th>Token</th>
            <SortTh s={s} field="score" label="Score" />
            <th className="text-right">Price</th>
            <th className="text-right">5m</th>
            <SortTh s={s} field="change_h1" label="1h" align="right" />
            <th className="text-right">6h</th>
            <SortTh s={s} field="change_h24" label="24h" align="right" />
            <SortTh s={s} field="liquidity" label="Liquidity" align="right" />
            <SortTh s={s} field="volume" label="Vol 24h" align="right" />
            {showAccel && <SortTh s={s} field="volume_accel" label="Vol accel" align="right" />}
            <SortTh s={s} field="mcap" label="MCap/FDV" align="right" />
            <th className="text-right">Txns 24h</th>
            <th className="text-right">Holders</th>
            <th>Security</th>
            <SortTh s={s} field="age" label="Age" align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const accel = r.volume_h1 && r.volume_h24 ? r.volume_h1 / (r.volume_h24 / 24) : null;
            const tx = r.buys_h24 !== null && r.sells_h24 !== null ? r.buys_h24 + r.sells_h24 : null;
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/token/${r.chain}/${r.id}`} className="flex items-center gap-2 hover:text-up">
                    <TokenAvatar symbol={r.symbol} logo={r.logo_url} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{r.symbol}</span>
                        <ChainBadge chain={r.chain} />
                        {r.is_demo && <DemoBadge />}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
