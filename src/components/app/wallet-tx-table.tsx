import Link from "next/link";
import { Badge, ChainBadge, EmptyState } from "@/components/ui";
import { CHAINS, type ChainId } from "@/lib/chains";
import { formatDateTime, formatNumber, shortAddress } from "@/lib/format";

export interface WalletTxRow {
  id: string;
  wallet_id: string;
  wallet_label: string | null;
  chain: string;
  tx_hash: string;
  block_time: Date;
  direction: string;
  token_address: string | null;
  token_symbol: string | null;
  amount: number | null;
  provider: string;
  token_id?: string | null;
}

const TONE = { buy: "up", sell: "down", transfer_in: "info", transfer_out: "warn", other: "neutral" } as const;

export function WalletTxTable({ rows, showWallet = true }: { rows: WalletTxRow[]; showWallet?: boolean }) {
  if (!rows.length) return <EmptyState title="No transactions recorded" body="Transactions appear after the next wallet sync, if a wallet data provider is configured for this chain." />;
  return (
    <div className="overflow-x-auto">
      <table className="table-terminal">
        <thead>
          <tr>{showWallet && <th>Wallet</th>}<th>Time (UTC)</th><th>Action</th><th>Token</th><th className="text-right">Amount</th><th>Tx</th><th>Source</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              {showWallet && <td><Link href={`/app/wallets/${t.wallet_id}`} className="hover:text-up">{t.wallet_label ?? "wallet"}</Link></td>}
              <td className="text-xs">{formatDateTime(t.block_time)}</td>
              <td><Badge tone={TONE[t.direction as keyof typeof TONE] ?? "neutral"}>{t.direction.replace("_", " ")}</Badge></td>
              <td>
                <span className="flex items-center gap-1.5">
                  {t.token_id ? <Link href={`/app/token/${t.chain}/${t.token_id}`} className="font-medium hover:text-up">{t.token_symbol ?? shortAddress(t.token_address)}</Link> : <span className="num text-fg-muted">{t.token_symbol ?? shortAddress(t.token_address)}</span>}
                  <ChainBadge chain={t.chain} />
                </span>
              </td>
              <td className="num text-right">{formatNumber(t.amount, 4)}</td>
              <td><a href={CHAINS[t.chain as ChainId]?.explorerTx(t.tx_hash)} target="_blank" rel="noopener noreferrer" className="num text-xs text-fg-muted hover:text-fg">{shortAddress(t.tx_hash, 6)} ↗</a></td>
              <td className="text-xs text-fg-faint">{t.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
