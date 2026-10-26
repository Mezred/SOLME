import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { FilterBar } from "@/components/app/filter-bar";
import { SIGNAL_FILTER_FIELDS } from "@/components/app/filter-fields";
import { Pagination } from "@/components/app/pagination";
import { SignalsTable } from "@/components/app/signals-table";
import { flatParams } from "@/components/app/url";
import { Card, Freshness, Notice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { listSignals, signalFilterSchema } from "@/lib/data/signals";
import { latestSnapshotTime } from "@/lib/data/tokens";

export const metadata: Metadata = { title: "Live Signals" };

export default async function SignalsPage({ searchParams }: PageProps<"/app/signals">) {
  const user = await requirePageUser("/app/signals");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const filters = signalFilterSchema.parse(flatParams(sp));
  const [page, latest] = await Promise.all([listSignals(filters, ent), latestSnapshotTime()]);
  return (
    <>
      <PageHeader
        title="Live Signals"
        description="Tokens whose live market data currently matches a documented pattern. Distribution and high-risk signals are warnings, not opportunities. Click any row for the full factor breakdown."
        badge={<Freshness at={latest} label="Data" />}
        actions={<AutoRefresh seconds={60} stream />}
      />
      <Suspense>
        <FilterBar fields={SIGNAL_FILTER_FIELDS} advancedAllowed={ent.features.advanced_filters} />
      </Suspense>
      {page.restrictions.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{page.restrictions.join(" ")}</Notice>
        </div>
      )}
      <Card>
        <SignalsTable rows={page.rows} base="/app/signals" params={sp} />
        <div className="border-t border-line">
          <Pagination base="/app/signals" params={sp} page={page.page} pageSize={page.pageSize} total={page.total} />
        </div>
      </Card>
    </>
  );
}
