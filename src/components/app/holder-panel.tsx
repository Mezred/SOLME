import { Badge, Card, CardHeader, EmptyState, Notice } from "@/components/ui";
import { CHAINS, type ChainId } from "@/lib/chains";
import { formatNumber, shortAddress, timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/log";
import { getHolderReport, type HolderReport } from "@/lib/tokens/holders";

/** Holder concentration, dev balance and launch-block buying. Wrap in <Suspense>. */
export async function HolderPanel({ chain, address }: { chain: ChainId; address: string }) {
  let r: HolderReport | null;
  try {
    r = await getHolderReport(chain, address);
  } catch (err) {
    return (
      <Card>
        <CardHeader title="Holders & launch" />
        <div className="p-4"><Notice tone="down" title="Holder data unavailable">{errorMessage(err)}</Notice></div>
      </Card>
    );
  }
  if (!r) {
    return (
      <Card>
        <CardHeader title="Holders & launch" />
        <EmptyState title="Not available" body="Needs HELIUS_API_KEY and a token with a readable supply." />
      </Card>
    );
  }
  const pct = (v: number) => `${formatNumber(v, v < 10 ? 1 : 0)}%`;
  const flags: { tone: "down" | "warn"; text: string }[] = [];
  if (r.top10WalletPct >= 30) flags.push({ tone: "down", text: `Top 10 wallets hold ${pct(r.top10WalletPct)}` });
  if (r.dev && r.dev.pct >= 5) flags.push({ tone: "warn", text: `Dev wallet holds ${pct(r.dev.pct)}` });
  if (r.launch && r.launch.bundlePct >= 10) flags.push({ tone: "down", text: `${r.launch.bundleWallets} wallets bought ${pct(r.launch.bundlePct)} in the launch block` });
  if (r.launch && r.launch.launchBuyersHoldPct >= 10) flags.push({ tone: "warn", text: `Launch buyers still hold ${pct(r.launch.launchBuyersHoldPct)}` });

  return (
    <Card>
      <CardHeader title="Holders & launch" subtitle={`On-chain snapshot · ${timeAgo(r.computedAt)}`} />
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-center">
        {[
          ["Top 10 wallets", pct(r.top10WalletPct), r.top10WalletPct >= 30],
          ["Dev holds", r.dev ? pct(r.dev.pct) : "—", Boolean(r.dev && r.dev.pct >= 5)],
          ["Launch-block buys", r.launch ? `${pct(r.launch.bundlePct)} · ${r.launch.bundleWallets}w` : "—", Boolean(r.launch && r.launch.bundlePct >= 10)],
          [`Snipers (first 10s)`, r.launch ? `${pct(r.launch.sniperPct)} · ${r.launch.sniperWallets}w` : "—", false],
        ].map(([label, value, bad]) => (
          <div key={label as string} className="bg-ink-850 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
            <div className={`num mt-0.5 text-sm ${bad ? "text-down" : ""}`}>{value}</div>
          </div>
        ))}
      </div>
      {flags.length > 0 && (
        <ul className="space-y-1 border-b border-line px-4 py-2.5 text-xs">
          {flags.map((f) => <li key={f.text} className={f.tone === "down" ? "text-down" : "text-warn"}>• {f.text}</li>)}
        </ul>
      )}
      <ul className="divide-y divide-line text-xs">
        {r.holders.slice(0, 10).map((h) => (
          <li key={h.owner} className="flex items-center justify-between gap-2 px-4 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <a href={CHAINS[chain].explorerAddress(h.owner)} target="_blank" rel="noopener noreferrer" className="num hover:text-up" title={h.owner}>{shortAddress(h.owner, 4)}</a>
              {h.kind === "program" && <Badge title="Owned by a program: pool, bonding curve, vault or locker">pool / program</Badge>}
              {h.isDev && <Badge tone="warn">dev</Badge>}
              {h.isLaunchBuyer && !h.isDev && <Badge tone="warn" title="Bought in the launch block or first 10 seconds">launch buyer</Badge>}
            </span>
            <span className="num shrink-0">{pct(h.pct)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
        Program-owned holders (pools, curves, vaults) are excluded from wallet concentration. Launch figures count tokens bought, not still held
        {r.dev?.source === "first_tx" ? ", and the dev is taken to be the signer of the token's first transaction" : ""}
        {r.dev?.source === "creator" ? ", and the dev is the contract's deployer" : ""}
        {r.basis === "goplus-top10" ? ". Holder list: GoPlus top 10 (history too long to rebuild), so concentration may be understated" : ""}. Coordination cannot be proven from this data.
      </p>
    </Card>
  );
}
