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
      <PageHeader title="Pricing & entitlements" description="Prices (in cents), Stripe price IDs and every feature limit are stored in the database and enforced server-side on the next request." />
      <div className="mb-4"><Notice tone="warn">Changing a displayed price does not change what Stripe charges existing subscribers. Create a new Price in Stripe, paste its ID here, and migrate subscribers in Stripe if needed.</Notice></div>
      <div className="space-y-4">
        {plans.map((p) => (
          <JsonSettingsForm
            key={p.id}
            title={`${p.name} (${p.id})`}
            endpoint={`/api/admin/plans/${p.id}`}
            nullableKeys={["stripe_price_monthly", "stripe_price_annual"]}
            initial={{
              name: p.name,
              description: p.description,
              price_monthly_cents: p.price_monthly_cents,
              price_annual_cents: p.price_annual_cents,
              stripe_price_monthly: p.stripe_price_monthly,
              stripe_price_annual: p.stripe_price_annual,
              is_active: p.is_active,
              features: p.features as never,
            }}
          />
        ))}
      </div>
    </>
  );
}
