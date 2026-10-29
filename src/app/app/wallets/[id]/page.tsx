import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UntrackWallet } from "@/components/app/wallet-forms";
import { WalletScoreCard, type WalletScoreRow } from "@/components/app/wallet-score";
import { WalletTxTable, type WalletTxRow } from "@/components/app/wallet-tx-table";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { CHAINS, type ChainId } from "@/lib/chains";
import { isUuid, withUser } from "@/lib/db";
import { formatNumber, shortAddress, timeAgo } from "@/lib/format";
import { walletProviderFor } from "@/lib/providers/wallets";

export const metadata: Metadata = { title: "Wallet" };

export default async function WalletPage({ params }: PageProps<"/app/wallets/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/app/wallets/${id}`);
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [w] = await tx.query<{ id: string; chain: string; address: string; label: string | null; classification: string; classification_source: string | null; source_url: string | null; is_public: boolean; last_synced_at: Date | null; custom_label: string | null; tracked: boolean }>(
      `SELECT w.*, t.custom_label, (t.wallet_id IS NOT NULL) AS tracked FROM wallet_profiles w
         LEFT JOIN user_tracked_wallets t ON t.wallet_id = w.id AND t.user_id = $2 WHERE w.id = $1`,
      [id, user.id],
    );
    if (!w) return null;
    const txs = await tx.query<WalletTxRow>(
      `SELECT x.id, x.wallet_id, NULL AS wallet_label, x.chain, x.tx_hash, x.block_time, x.direction, x.token_address,
              COALESCE(x.token_symbol, ta.symbol) AS token_symbol, x.amount, x.provider, ta.id AS token_id
         FROM wallet_transactions x LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.wallet_id = $1 ORDER BY x.block_time DESC LIMIT 200`,
      [id],
    );
    const exposure = await tx.query<{ token_address: string; token_symbol: string | null; inflow: number; outflow: number; txs: number; last: Date }>(
      `SELECT x.token_address, max(COALESCE(x.token_symbol, ta.symbol)) AS token_symbol,
              sum(CASE WHEN x.direction IN ('buy', 'transfer_in') THEN x.amount ELSE 0 END) AS inflow,
              sum(CASE WHEN x.direction IN ('sell', 'transfer_out') THEN x.amount ELSE 0 END) AS outflow,
              count(*)::int AS txs, max(x.block_time) AS last
         FROM wallet_transactions x LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.wallet_id = $1 AND x.token_address IS NOT NULL GROUP BY x.token_address ORDER BY last DESC LIMIT 30`,
      [id],
    );
    const [score] = await tx.query<WalletScoreRow>("SELECT * FROM wallet_scores WHERE wallet_id = $1", [id]);
    return { w, txs, exposure, score: score ?? null };
  });
  if (!data) notFound();
  const { w, txs, exposure, score } = data;
  const provider = walletProviderFor(w.chain as ChainId);
  const buys = txs.filter((t) => t.direction === "buy" || t.direction === "transfer_in").length;
  const sells = txs.filter((t) => t.direction === "sell" || t.direction === "transfer_out").length;

  return (
    <>
      <PageHeader
        title={w.custom_label ?? w.label ?? shortAddress(w.address, 6)}
        badge={<ChainBadge chain={w.chain} />}
        description={<span className="num break-all">{w.address}</span>}
        actions={<>{w.tracked && <UntrackWallet id={w.id} />}<a href={CHAINS[w.chain as ChainId]?.explorerAddress(w.address)} target="_blank" rel="noopener noreferrer" className="text-sm text-fg-muted hover:text-fg">Explorer ↗</a></>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {w.classification === "unknown" ? (
          <Badge>Unclassified</Badge>
        ) : (
          <>
            <Badge tone="ai">{w.classification.replace("_", " ")}</Badge>
            <span className="text-xs text-fg-faint">Source: {w.source_url ? <a href={w.source_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{w.classification_source}</a> : w.classification_source}</span>
          </>
        )}
      </div>
      {(!provider || !provider.configured()) && (
        <div className="mb-4"><Notice tone="warn">{provider ? `${provider.name} is not configured — set HELIUS_API_KEY to sync this wallet.` : "No wallet-activity provider supports this chain yet."}</Notice></div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Recorded transactions" value={txs.length} />
        <Stat label="Inflows" value={buys} sub="buys + transfers in" tone="up" />
        <Stat label="Outflows" value={sells} sub="sells + transfers out" tone="down" />
        <Stat label="Last synced" value={w.last_synced_at ? timeAgo(w.last_synced_at) : "never"} />
      </div>
      {(
        <>
          <p className="mt-2 text-xs text-fg-faint">The counts above come from recorded transfers. The score below is computed separately from the wallet&apos;s own swaps.</p>
          <div className="mt-4"><WalletScoreCard s={score} /></div>
        </>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader title="Token exposure (recorded window)" subtitle="Net of recorded inflows and outflows — not a balance" />
          {exposure.length === 0 ? <EmptyState title="No token activity" /> : (
            <ul className="divide-y divide-line text-sm">
              {exposure.map((e) => {
                const net = (e.inflow ?? 0) - (e.outflow ?? 0);
                return (
                  <li key={e.token_address} className="flex items-center justify-between px-4 py-2">
                    <span className="font-medium">{e.token_symbol ?? shortAddress(e.token_address)}</span>
                    <span className={`num text-xs ${net >= 0 ? "text-up" : "text-down"}`}>{net >= 0 ? "+" : ""}{formatNumber(net, 2)} <span className="text-fg-faint">· {e.txs} tx</span></span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Transactions" />
          <WalletTxTable rows={txs} showWallet={false} />
        </Card>
      </div>
    </>
  );
}
