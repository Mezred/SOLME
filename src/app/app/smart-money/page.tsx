import type { Metadata } from "next";
import Link from "next/link";
import { WalletTxTable, type WalletTxRow } from "@/components/app/wallet-tx-table";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, UpgradeGate } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query } from "@/lib/db";
import { integrations } from "@/lib/env";
import { shortAddress, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Smart Money" };

const DOCUMENTED = "('whale', 'fund', 'smart_money')";

export default async function SmartMoneyPage() {
  const user = await requirePageUser("/app/smart-money");
  const ent = await getEntitlements(user.id);
  if (!ent.features.smart_money) {
    return (
      <>
        <PageHeader title="Smart Money" description="Aggregated activity of wallets with a documented whale, fund or Smart Money classification." />
        <UpgradeGate feature="Smart Money tracking" plan="Elite" />
      </>
    );
  }
  const [wallets, flows, txs] = await Promise.all([
    query<{ id: string; chain: string; address: string; label: string | null; classification: string; classification_source: string; source_url: string | null; last_synced_at: Date | null }>(
      `SELECT id, chain, address, label, classification, classification_source, source_url, last_synced_at FROM wallet_profiles
        WHERE is_public AND classification IN ${DOCUMENTED} AND chain = ANY($1) ORDER BY classification, label`,
      [ent.features.chains],
    ),
    query<{ chain: string; token_address: string; symbol: string | null; token_id: string | null; buyers: number; sellers: number; txs: number }>(
      `SELECT x.chain, x.token_address, max(ta.symbol) AS symbol, max(ta.id::text) AS token_id,
              count(DISTINCT x.wallet_id) FILTER (WHERE x.direction IN ('buy', 'transfer_in'))::int AS buyers,
              count(DISTINCT x.wallet_id) FILTER (WHERE x.direction IN ('sell', 'transfer_out'))::int AS sellers,
              count(*)::int AS txs
         FROM wallet_transactions x JOIN wallet_profiles w ON w.id = x.wallet_id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE w.is_public AND w.classification IN ${DOCUMENTED} AND x.block_time > now() - interval '24 hours' AND x.chain = ANY($1) AND x.token_address IS NOT NULL
        GROUP BY x.chain, x.token_address ORDER BY (count(DISTINCT x.wallet_id)) DESC LIMIT 30`,
      [ent.features.chains],
    ),
    query<WalletTxRow>(
      `SELECT x.id, x.wallet_id, COALESCE(w.label, left(w.address, 8)) AS wallet_label, x.chain, x.tx_hash, x.block_time, x.direction, x.token_address,
              COALESCE(x.token_symbol, ta.symbol) AS token_symbol, x.amount, x.provider, ta.id AS token_id
         FROM wallet_transactions x JOIN wallet_profiles w ON w.id = x.wallet_id LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE w.is_public AND w.classification IN ${DOCUMENTED} AND x.chain = ANY($1) ORDER BY x.block_time DESC LIMIT 60`,
      [ent.features.chains],
    ),
  ]);

  return (
    <>
      <PageHeader title="Smart Money" description="Activity of wallets whose classification has a documented public source, curated by NEXALPHA administrators. Labels are never inferred from trading behaviour alone." />
      {(!integrations.helius || !integrations.alchemy) && (
        <div className="mb-4"><Notice tone="warn">Wallet activity providers are not fully configured (Helius for Solana, Alchemy for Ethereum/Base), so recorded activity may be incomplete.</Notice></div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Token flows · 24h" subtitle="Distinct documented wallets with inflows vs outflows" />
          {flows.length === 0 ? <EmptyState title="No documented-wallet activity in 24h" /> : (
            <table className="table-terminal">
              <thead><tr><th>Token</th><th className="text-right">Accumulating</th><th className="text-right">Distributing</th><th className="text-right">Txs</th><th>Bias</th></tr></thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={`${f.chain}:${f.token_address}`}>
                    <td><span className="flex items-center gap-1.5">{f.token_id ? <Link href={`/app/token/${f.chain}/${f.token_id}`} className="font-medium hover:text-up">{f.symbol ?? shortAddress(f.token_address)}</Link> : <span className="num">{shortAddress(f.token_address)}</span>}<ChainBadge chain={f.chain} /></span></td>
                    <td className="num text-right text-up">{f.buyers}</td>
                    <td className="num text-right text-down">{f.sellers}</td>
                    <td className="num text-right text-fg-muted">{f.txs}</td>
                    <td>{f.buyers > f.sellers ? <Badge tone="up">accumulation</Badge> : f.sellers > f.buyers ? <Badge tone="down">distribution</Badge> : <Badge>mixed</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <CardHeader title="Documented wallets" subtitle={`${wallets.length} profiles`} />
          {wallets.length === 0 ? (
            <EmptyState title="No documented wallets yet" body="Administrators add wallets here only with a cited public source (e.g. an on-chain disclosure or a fund's published address)." />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {wallets.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link href={`/app/wallets/${w.id}`} className="min-w-0 hover:text-up">
                    <div className="font-medium">{w.label ?? shortAddress(w.address, 6)} <ChainBadge chain={w.chain} /></div>
                    <div className="truncate text-xs text-fg-faint">Source: {w.classification_source}</div>
                  </Link>
                  <span className="flex flex-col items-end gap-1"><Badge tone="ai">{w.classification.replace("_", " ")}</Badge><span className="text-[10px] text-fg-faint">synced {timeAgo(w.last_synced_at)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Latest documented-wallet transactions" />
        <WalletTxTable rows={txs} />
      </Card>
    </>
  );
}
