import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section } from "@/components/marketing/sections";
import { Disclaimer } from "@/components/ui";
import { getPricingPlans } from "@/lib/data/marketing";

export const metadata: Metadata = { title: "Pricing", description: "Free, Pro and Elite plans for SOLME's Solana on-chain research terminal." };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await getPricingPlans();
  return (
    <Section as="h1" eyebrow="Pricing" title="Simple plans. Cancel anytime." intro="Start free on Solana. Upgrade for advanced screener filters, Telegram alerts, smart wallets and proven-dev launches. Prices in USD; taxes may apply.">
      <PricingCards plans={plans} />
      <div className="mt-12 grid gap-6 text-sm text-fg-muted md:grid-cols-3">
        <div><h3 className="mb-1 font-semibold text-fg">How billing works</h3><p>Pay by card through Stripe (your card details never touch our servers), or with USDC or SOL on Solana. Plans activate only once the payment is confirmed, on-chain within seconds for crypto.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Changing plans</h3><p>Upgrades and downgrades are prorated. Cancel anytime from Billing and keep access until the end of the paid period. Crypto plans are prepaid: no auto-renewal, a reminder before they end.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Failed payments</h3><p>If a renewal fails, access continues for a short grace period while Stripe retries. Questions? <Link href="/contact" className="text-up">Contact support</Link>.</p></div>
      </div>
      <Disclaimer className="mt-10" />
    </Section>
  );
}
