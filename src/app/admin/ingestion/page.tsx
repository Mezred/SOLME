import type { Metadata } from "next";
import { AdminAction, JsonSettingsForm } from "@/components/admin/admin-forms";
import { Notice, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Data refresh" };

export default async function AdminIngestion() {
  await requirePageAdmin();
  const s = await getSetting("ingestion");
  return (
    <>
      <PageHeader title="Market data refresh" description="Centralized ingestion shared by all users. Shorter intervals increase provider usage — GeckoTerminal's keyless tier allows roughly 10 requests per minute." actions={<AdminAction endpoint="/api/admin/ingest" method="POST" label="Run now" confirm="Queue a cycle?" variant="primary" />} />
      <div className="mb-4"><Notice tone="info">SOLME covers Solana only (chain id: solana). Disabling ingestion stops new data and scores; the site keeps serving the last snapshots with staleness labels.</Notice></div>
      <JsonSettingsForm endpoint="/api/admin/settings/ingestion" initial={s as never} />
    </>
  );
}
