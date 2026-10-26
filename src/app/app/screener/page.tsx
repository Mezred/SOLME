import type { Metadata } from "next";
import { Suspense } from "react";
import { FilterBar } from "@/components/app/filter-bar";
import { SCREENER_FILTER_FIELDS } from "@/components/app/filter-fields";
import { Pagination } from "@/components/app/pagination";
import { TokenTable } from "@/components/app/token-table";
import { flatParams } from "@/components/app/url";
import { Card, Freshness, Notice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { latestSnapshotTime, listTokens, tokenFilterSchema } from "@/lib/data/tokens";

export const metadata: Metadata = { title: "Token Screener" };

export default async function ScreenerPage({ searchParams }: PageProps<"/app/screener">) {
  const user = await requirePageUser("/app/screener");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const filters = tokenFilterSchema.parse(flatParams(sp));
  const [res, latest] = await Promise.all([listTokens(filters, ent.features.chains, { advanced: ent.features.advanced_filters }), latestSnapshotTime()]);
  return (
    <>
      <PageHeader
        title="Token Screener"
        description="Every token the engine is tracking, with its latest snapshot. Scores shown are from the most recent scoring pass. Tokens flagged as obvious spam are hidden."
        badge={<Freshness at={latest} label="Data" />}
      />
      <Suspense>
        <FilterBar fields={SCREENER_FILTER_FIELDS} advancedAllowed={ent.features.advanced_filters} />
      </Suspense>
      {res.restrictions.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{res.restrictions.join(" ")}</Notice>
        </div>
      )}
      <Card>
        <TokenTable rows={res.rows} base="/app/screener" params={sp} showAccel />
        <div className="border-t border-line">
          <Pagination base="/app/screener" params={sp} page={res.page} pageSize={res.pageSize} total={res.total} />
        </div>
      </Card>
    </>
  );
}
