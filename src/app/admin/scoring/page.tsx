import type { Metadata } from "next";
import { JsonSettingsForm } from "@/components/admin/admin-forms";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { FACTOR_DOCS } from "@/lib/scoring/engine";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Scoring weights" };

export default async function AdminScoring() {
  await requirePageAdmin();
  const s = await getSetting("scoring");
  return (
    <>
      <PageHeader title="Scoring weights & thresholds" description="Weights are relative (renormalized over available factors). Bump the version when you change methodology — every score stores the version that produced it." />
      <div className="mb-4"><Notice tone="info">Changes apply from the next ingestion cycle; each token is re-scored when it is next ingested.</Notice></div>
      <JsonSettingsForm endpoint="/api/admin/settings/scoring" initial={s as never} />
      <Card className="mt-4">
        <CardHeader title="Factor reference" />
        <table className="table-terminal">
          <thead><tr><th>Key</th><th>Category</th><th>Description</th><th>Inputs</th></tr></thead>
          <tbody>{Object.entries(FACTOR_DOCS).map(([k, d]) => <tr key={k}><td className="num">{k}</td><td>{d.category}</td><td className="whitespace-normal text-xs text-fg-muted">{d.description}</td><td className="text-xs text-fg-faint">{d.inputs}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
