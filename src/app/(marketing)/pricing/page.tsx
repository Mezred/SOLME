import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section } from "@/components/marketing/sections";
import { Disclaimer } from "@/components/ui";
import { getPricingPlans } from "@/lib/data/marketing";

export const metadata: Metadata = { title: "Pricing", description: "Free, Pro and Elite plans for NEXALPHA's multi-chain on-chain research terminal." };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await getPricingPlans();
  return (
    <Section eyebrow="Pricing" title="Simple plans. Cancel anytime." intro="Start free on Solana and Base. Upgrade for every chain, real-time signals, deep AI analysis, custom alerts and wallet intelligence. Prices in USD; taxes may apply.">
      <PricingCards plans={plans} />
      <div className="mt-12 grid gap-6 text-sm text-fg-muted md:grid-cols-3">
        <div><h3 className="mb-1 font-semibold text-fg">How billing works</h3><p>Payments are processed by Stripe. Plans activate only after Stripe confirms payment; your card details never touch our servers.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Changing plans</h3><p>Upgrades and downgrades are prorated. Cancel anytime from Billing and keep access until the end of the paid period.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Failed payments</h3><p>If a renewal fails, access continues for a short grace period while Stripe retries. Questions? <Link href="/contact" className="text-up">Contact support</Link>.</p></div>
      </div>
      <Disclaimer className="mt-10" />
    </Section>
  );
}
