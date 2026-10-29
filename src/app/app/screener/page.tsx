import type { Metadata } from "next";
import { Suspense } from "react";
import { Pagination } from "@/components/app/pagination";
import { ScreenerFilters } from "@/components/app/screener-filters";
import { ScreenerTemplates } from "@/components/app/screener-templates";
import { TokenTable } from "@/components/app/token-table";
import { flatParams } from "@/components/app/url";
import { Card, Freshness, Notice, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { listTemplates, TEMPLATE_KEYS } from "@/lib/data/screener-templates";
import { queryOne, withUser } from "@/lib/db";
import { CHAINS } from "@/lib/chains";
import { latestSnapshotTime, listTokens, screenerCoverage, tokenFilterSchema } from "@/lib/data/tokens";

export const metadata: Metadata = { title: "Screener" };

export default async function ScreenerPage({ searchParams }: PageProps<"/app/screener">) {
  const user = await requirePageUser("/app/screener");
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const filters = tokenFilterSchema.parse(flatParams(sp));
  const [res, latest, templates, rules, profile, coverage] = await Promise.all([
    listTokens(filters, ent.features.chains, { advanced: ent.features.advanced_filters }),
    latestSnapshotTime(),
    listTemplates(user.id),
    withUser(user.id, (tx) => tx.query<{ id: string; template_id: string }>("SELECT id, params->>'template_id' AS template_id FROM alert_rules WHERE rule_type = 'screener_match'")),
    queryOne<{ notify_telegram: boolean; telegram_chat_id: string | null }>("SELECT notify_telegram, telegram_chat_id FROM profiles WHERE user_id = $1", [user.id]),
    screenerCoverage(ent.features.chains),
  ]);
  const alerts = Object.fromEntries(rules.map((r) => [r.template_id, r.id]));
  const telegram = ent.features.alert_channels.includes("telegram") && Boolean(profile?.notify_telegram && profile.telegram_chat_id);
  return (
    <>
      <PageHeader
        title="Screener"
        description={`${res.total.toLocaleString("en-US")} of ${coverage.total.toLocaleString("en-US")} tracked pairs match (${coverage.byChain.map((c) => `${CHAINS[c.chain].short} ${c.n.toLocaleString("en-US")}`).join(" · ") || "none yet"}). Tracked = every trending, new, launchpad and boosted pair SOLME has picked up; active pairs refresh every ~2 minutes; spam hidden.`}
        badge={<Freshness at={latest} label="Data" />}
      />
      <Suspense>
        <ScreenerTemplates templates={templates} keys={TEMPLATE_KEYS} alerts={alerts} telegram={telegram} />
        {/* Keyed by the query so applying a template or quick scan also refills the inputs. */}
        <ScreenerFilters key={new URLSearchParams(flatParams(sp)).toString()} advancedAllowed={ent.features.advanced_filters} />
      </Suspense>
      {res.restrictions.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{res.restrictions.join(" ")}</Notice>
        </div>
      )}
      <Card>
        <TokenTable rows={res.rows} base="/app/screener" params={sp} showAccel showUpdated />
        <div className="border-t border-line">
          <Pagination base="/app/screener" params={sp} page={res.page} pageSize={res.pageSize} total={res.total} />
        </div>
      </Card>
    </>
  );
}
