import type { Metadata } from "next";
import { AdminAction, DocumentWalletForm } from "@/components/admin/admin-forms";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { query } from "@/lib/db";
import { shortAddress, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Documented wallets" };

export default async function AdminWallets() {
  await requirePageAdmin();
  const rows = await query<{ id: string; chain: string; address: string; label: string | null; classification: string; classification_source: string | null; source_url: string | null; last_synced_at: Date | null }>(
    "SELECT id, chain, address, label, classification, classification_source, source_url, last_synced_at FROM wallet_profiles WHERE is_public ORDER BY created_at DESC",
  );
  return (
    <>
      <PageHeader title="Documented wallets" description="Public wallet profiles that power Smart Money tracking and the smart-money scoring factor." />
      <div className="mb-4"><Notice tone="warn">Only add a whale/fund/Smart Money classification when you can cite a verifiable public source. The database rejects classifications without a source.</Notice></div>
      <DocumentWalletForm />
      <Card className="mt-4">
        <CardHeader title={`Public profiles (${rows.length})`} />
        {rows.length === 0 ? <EmptyState title="None yet" /> : (
          <div className="overflow-x-auto"><table className="table-terminal">
            <thead><tr><th>Label</th><th>Chain</th><th>Address</th><th>Class</th><th>Source</th><th>Synced</th><th /></tr></thead>
            <tbody>{rows.map((w) => (
              <tr key={w.id}><td>{w.label}</td><td><ChainBadge chain={w.chain} /></td><td className="num text-xs">{shortAddress(w.address, 6)}</td><td><Badge tone="ai">{w.classification}</Badge></td>
                <td className="max-w-xs truncate text-xs text-fg-muted" title={w.classification_source ?? undefined}>{w.source_url ? <a href={w.source_url} target="_blank" rel="noopener noreferrer" className="underline">{w.classification_source}</a> : w.classification_source}</td>
                <td className="text-xs">{timeAgo(w.last_synced_at)}</td>
                <td><AdminAction endpoint={`/api/admin/wallets?id=${w.id}`} method="DELETE" label="Remove label" confirm="Remove public classification?" variant="danger" /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
