import type { Metadata } from "next";
import { JsonSettingsForm } from "@/components/admin/admin-forms";
import { Notice, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { listPlans } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Pricing & entitlements" };

export default async function AdminPlans() {
  await requirePageAdmin();
  const plans = await listPlans(true);
  return (
    <>
      <PageHeader title="Pricing & entitlements" description="Prices (in cents) and every feature limit are stored in the database and enforced server-side on the next request." />
      <div className="mb-4"><Notice tone="info">Plans are paid in USDC or SOL at these prices. A change applies to new quotes only: quotes already issued keep their amount until they expire (30 minutes), and prepaid periods are not repriced.</Notice></div>
      <div className="space-y-4">
        {plans.map((p) => (
          <JsonSettingsForm
            key={p.id}
            title={`${p.name} (${p.id})`}
            endpoint={`/api/admin/plans/${p.id}`}
            initial={{
              name: p.name,
              description: p.description,
              price_monthly_cents: p.price_monthly_cents,
              price_annual_cents: p.price_annual_cents,
              is_active: p.is_active,
              features: p.features as never,
            }}
          />
        ))}
      </div>
    </>
  );
}
