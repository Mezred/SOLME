import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { hrefWith } from "@/components/app/url";
import { Badge, buttonClass, Card, ChainBadge, cx, DemoBadge, EmptyState, Notice, PageHeader, PriceChange, RiskBadge, TokenAvatar } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, isChainId } from "@/lib/chains";
import { newLaunches } from "@/lib/data/tokens";
import { formatAge, formatPrice, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "New Launches" };

const WINDOWS = [6, 24, 72];
const MIN_LIQ = [0, 10_000, 50_000, 100_000];

export default async function LaunchesPage({ searchParams }: PageProps<"/app/launches">) {
  const user = await requirePageUser("/app/launches");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const hours = WINDOWS.includes(Number(sp.hours)) ? Number(sp.hours) : 24;
  const minLiq = MIN_LIQ.includes(Number(sp.minLiq)) ? Number(sp.minLiq) : 10_000;
  const chain = typeof sp.chain === "string" && isChainId(sp.chain) && ent.features.chains.includes(sp.chain) ? sp.chain : null;
  const rows = (await newLaunches(chain ? [chain] : ent.features.chains, hours, 150)).filter((r) => (r.liquidity_usd ?? 0) >= minLiq);

  const chip = (active: boolean) => cx(buttonClass(active ? "secondary" : "ghost", "sm"), active && "border-up/40 text-up");
  return (
    <>
      <PageHeader
        title="New Launches"
        description="Pairs created recently across your chains, deduplicated by chain and contract address. New pairs carry the highest risk: liquidity can be removed, and security checks may not be complete yet."
        actions={<AutoRefresh seconds={60} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-faint">Created within</span>
        {WINDOWS.map((h) => (
          <Link key={h} href={hrefWith("/app/launches", sp, { hours: h })} className={chip(h === hours)}>
            {h}h
          </Link>
        ))}
        <span className="ml-3 text-xs text-fg-faint">Min liquidity</span>
        {MIN_LIQ.map((l) => (
          <Link key={l} href={hrefWith("/app/launches", sp, { minLiq: l })} className={chip(l === minLiq)}>
            {l === 0 ? "Any" : formatUsd(l)}
          </Link>
        ))}
        <span className="ml-3 text-xs text-fg-faint">Chain</span>
        <Link href={hrefWith("/app/launches", sp, { chain: undefined })} className={chip(!chain)}>
          All
        </Link>
        {ent.features.chains.map((c) => (
          <Link key={c} href={hrefWith("/app/launches", sp, { chain: c })} className={chip(chain === c)}>
            {CHAINS[c].short}
          </Link>
        ))}
      </div>
      <div className="mb-4">
        <Notice tone="warn">Filters remove obviously broken or impersonating listings only. They do not eliminate scams.</Notice>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No new pairs match" body="Try a wider time window or a lower liquidity threshold." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead>
                <tr>
                  <th>Token</th>
                  <th className="text-right">Age</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">5m</th>
                  <th className="text-right">1h</th>
                  <th className="text-right">Liquidity</th>
                  <th className="text-right">Vol 24h</th>
                  <th className="text-right">MCap/FDV</th>
                  <th className="text-right">Buys/Sells 1h</th>
                  <th>Security</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/app/token/${t.chain}/${t.id}`} className="flex items-center gap-2 hover:text-up">
                        <TokenAvatar symbol={t.symbol} logo={t.logo_url} />
                        <span className="font-semibold">{t.symbol}</span>
                        <ChainBadge chain={t.chain} />
                        {t.is_demo && <DemoBadge />}
                      </Link>
                    </td>
                    <td className={`num text-right ${t.pair_created_at && Date.now() - new Date(t.pair_created_at).getTime() < 3_600_000 ? "text-warn" : ""}`}>{formatAge(t.pair_created_at)}</td>
                    <td className="num text-right">{formatPrice(t.price_usd)}</td>
                    <td className="text-right"><PriceChange value={t.price_change_m5} /></td>
                    <td className="text-right"><PriceChange value={t.price_change_h1} /></td>
                    <td className="num text-right">{formatUsd(t.liquidity_usd)}</td>
                    <td className="num text-right">{formatUsd(t.volume_h24)}</td>
                    <td className="num text-right text-fg-muted">{formatUsd(t.market_cap ?? t.fdv)}</td>
                    <td className="num text-right">
                      <span className="text-up">{t.buys_h1 ?? "—"}</span> / <span className="text-down">{t.sells_h1 ?? "—"}</span>
                    </td>
                    <td><RiskBadge level={t.security_risk} /></td>
                    <td>{t.metadata?.promoted ? <Badge tone="warn" title="Paid promotion on DexScreener — not a quality signal">Promoted</Badge> : <Badge>{t.metadata?.discovery ?? "scan"}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
