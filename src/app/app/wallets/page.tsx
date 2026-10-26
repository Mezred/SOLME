import type { Metadata } from "next";
import Link from "next/link";
import { TrackWalletForm, UntrackWallet } from "@/components/app/wallet-forms";
import { WalletTxTable, type WalletTxRow } from "@/components/app/wallet-tx-table";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { withUser } from "@/lib/db";
import { integrations } from "@/lib/env";
import { shortAddress, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Whale Tracker" };

export default async function WalletsPage() {
  const user = await requirePageUser("/app/wallets");
  const ent = await getEntitlements(user.id);
  const { wallets, txs } = await withUser(user.id, async (tx) => ({
    wallets: await tx.query<{ id: string; chain: string; address: string; label: string | null; classification: string; classification_source: string | null; last_synced_at: Date | null; custom_label: string | null; tx_count: number }>(
      `SELECT w.id, w.chain, w.address, w.label, w.classification, w.classification_source, w.last_synced_at, t.custom_label,
              (SELECT count(*)::int FROM wallet_transactions x WHERE x.wallet_id = w.id) AS tx_count
         FROM user_tracked_wallets t JOIN wallet_profiles w ON w.id = t.wallet_id ORDER BY t.created_at DESC`,
    ),
    txs: await tx.query<WalletTxRow>(
      `SELECT x.id, x.wallet_id, COALESCE(t.custom_label, w.label, left(w.address, 8)) AS wallet_label, x.chain, x.tx_hash, x.block_time, x.direction,
              x.token_address, COALESCE(x.token_symbol, ta.symbol) AS token_symbol, x.amount, x.provider, ta.id AS token_id
         FROM wallet_transactions x JOIN user_tracked_wallets t ON t.wallet_id = x.wallet_id JOIN wallet_profiles w ON w.id = x.wallet_id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        ORDER BY x.block_time DESC LIMIT 100`,
    ),
  }));

  if (ent.features.max_tracked_wallets === 0) return (<><PageHeader title="Whale Tracker" description="Track any public wallet's token transfers and swaps." /><UpgradeGate feature="Wallet tracking" /></>);

  return (
    <>
      <PageHeader title="Whale Tracker" description={`Track public wallets (${wallets.length}/${ent.features.max_tracked_wallets}). Labels you add are private to you. NEXALPHA only shows a wallet as a whale, fund or Smart Money when that classification has a documented source.`} />
      {(!integrations.helius || !integrations.alchemy) && (
        <div className="mb-4">
          <Notice tone="warn" title="Wallet data provider not fully configured">
            {!integrations.helius && "Solana wallet activity requires HELIUS_API_KEY. "}
            {!integrations.alchemy && "Ethereum and Base wallet activity requires ALCHEMY_API_KEY. "}
            BNB Smart Chain wallet transfers are not supported by the current providers. You can still track wallets; transactions appear once a provider is configured.
          </Notice>
        </div>
      )}
      <TrackWalletForm chains={ent.features.chains} />
      <Card className="mt-4">
        <CardHeader title="Tracked wallets" />
        {wallets.length === 0 ? <EmptyState title="No wallets tracked" body="Paste a public wallet address above." /> : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead><tr><th>Wallet</th><th>Chain</th><th>Classification</th><th className="text-right">Transactions</th><th className="text-right">Last synced</th><th /></tr></thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id}>
                    <td><Link href={`/app/wallets/${w.id}`} className="hover:text-up"><span className="font-medium">{w.custom_label ?? w.label ?? "Unlabeled"}</span> <span className="num text-xs text-fg-faint">{shortAddress(w.address, 6)}</span></Link></td>
                    <td><ChainBadge chain={w.chain} /></td>
                    <td>{w.classification === "unknown" ? <span className="text-xs text-fg-faint">Unclassified</span> : <Badge tone="ai" title={`Source: ${w.classification_source}`}>{w.classification.replace("_", " ")}</Badge>}</td>
                    <td className="num text-right">{w.tx_count}</td>
                    <td className="text-right text-xs text-fg-faint">{w.last_synced_at ? timeAgo(w.last_synced_at) : "never"}</td>
                    <td className="text-right"><UntrackWallet id={w.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="Recent activity" subtitle="Across your tracked wallets. Directions reflect transfers involving the wallet; buy/sell is only shown for detected swaps." />
        <WalletTxTable rows={txs} />
      </Card>
    </>
  );
}
