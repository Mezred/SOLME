import Link from "next/link";
import { Badge, ChainBadge, DemoBadge, EmptyState, PriceChange, RiskBadge, ScoreRing, SignalTypeBadge, StrengthBadge, TokenAvatar } from "@/components/ui";
import type { SignalRow } from "@/lib/data/signals";
import { formatAge, formatPrice, formatUsd, timeAgo } from "@/lib/format";
import { SortHeader } from "./pagination";
import type { SearchParamsRecord } from "./url";

function Pressure({ buys, sells }: { buys: number | null; sells: number | null }) {
  if (buys === null || sells === null || buys + sells === 0) return <span className="text-fg-faint">—</span>;
  const share = buys / (buys + sells);
  const label = share >= 0.58 ? "Buy pressure" : share <= 0.42 ? "Sell pressure" : "Balanced";
  return (
    <div className="w-24" title={`${buys} buys / ${sells} sells (1h). Counts transactions, not size.`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-down/60">
        <div className="bg-up" style={{ width: `${share * 100}%` }} />
      </div>
      <div className={`mt-1 text-[10px] ${share >= 0.58 ? "text-up" : share <= 0.42 ? "text-down" : "text-fg-faint"}`}>
        {label} {(share * 100).toFixed(0)}%
      </div>
    </div>
  );
}

export function SignalsTable({ rows, base, params, sortable = true, emptyText }: { rows: SignalRow[]; base: string; params: SearchParamsRecord; sortable?: boolean; emptyText?: string }) {
  if (rows.length === 0)
    return <EmptyState title={emptyText ?? "No signals match these filters"} body="Signals appear when live data meets a documented pattern with enough confidence. Try widening filters or check back after the next ingestion cycle." />;
  const H = ({ field, label, align }: { field: string; label: string; align?: "left" | "right" }) =>
    sortable ? <SortHeader base={base} params={params} field={field} label={label} align={align} /> : <th className={align === "right" ? "text-right" : undefined}>{label}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="table-terminal">
        <thead>
          <tr>
            <th>Token</th>
            <th>Signal</th>
            <H field="score" label="AI score" />
            <H field="confidence" label="Conf." align="right" />
            <th className="text-right">Price</th>
            <th className="text-right">5m</th>
            <H field="change_h1" label="1h" align="right" />
            <H field="change_h24" label="24h" align="right" />
            <H field="liquidity" label="Liquidity" align="right" />
            <H field="volume" label="Vol 24h" align="right" />
            <H field="mcap" label="MCap" align="right" />
            <th>Flow 1h</th>
            <th>Security</th>
            <th className="text-right">Age</th>
            <H field="created" label="Signal" align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/app/token/${r.chain}/${r.token_id}?signal=${r.id}`} className="flex items-center gap-2 hover:text-up">
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
              <td>
                <div className="flex flex-col items-start gap-1">
                  <SignalTypeBadge type={r.signal_type} />
                  <StrengthBadge strength={r.strength} />
                </div>
              </td>
              <td>
                <div className="flex items-center gap-2" title={`Quality ${r.quality_score ?? "—"} · Momentum ${r.momentum_score ?? "—"} · Risk ${r.risk_score ?? "—"}`}>
                  <ScoreRing score={r.ai_score} size={34} />
                  <div className="hidden text-[10px] leading-tight text-fg-faint xl:block">
                    <div>Q {r.quality_score ?? "—"}</div>
                    <div>M {r.momentum_score ?? "—"}</div>
                    <div>R {r.risk_score ?? "—"}</div>
                  </div>
                </div>
              </td>
              <td className="num text-right text-fg-muted">{r.confidence_score}</td>
              <td className="num text-right">{formatPrice(r.price_usd)}</td>
              <td className="text-right"><PriceChange value={r.price_change_m5} /></td>
              <td className="text-right"><PriceChange value={r.price_change_h1} /></td>
              <td className="text-right"><PriceChange value={r.price_change_h24} /></td>
              <td className="num text-right">{formatUsd(r.liquidity_usd)}</td>
              <td className="num text-right">{formatUsd(r.volume_h24)}</td>
              <td className="num text-right text-fg-muted">{formatUsd(r.market_cap ?? r.fdv)}</td>
              <td><Pressure buys={r.buys_h1} sells={r.sells_h1} /></td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  <RiskBadge level={r.security_risk} />
                  {r.risk_flags.length > 0 && <span className="text-[10px] text-warn" title={r.risk_flags.join("\n")}>{r.risk_flags.length} flag{r.risk_flags.length > 1 ? "s" : ""}</span>}
                </div>
              </td>
              <td className="num text-right text-fg-muted">{formatAge(r.pair_created_at)}</td>
              <td className="text-right text-xs text-fg-faint">
                {timeAgo(r.created_at)}
                {r.status !== "active" && <div><Badge>{r.status}</Badge></div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
