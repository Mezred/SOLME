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
    <Section as="h1" eyebrow="Pricing" title="Simple plans. No subscription trap." intro="Start free on Solana. Upgrade for every Early Coin, Telegram alerts, Smart Wallets and Proven Dev launches. Prices in USD; taxes may apply.">
      <PricingCards plans={plans} />
      <div className="mt-12 grid gap-6 text-sm text-fg-muted md:grid-cols-3">
        <div><h3 className="mb-1 font-semibold text-fg">How billing works</h3><p>Pay with USDC or SOL on Solana, from any wallet, via Solana Pay. Your plan activates as soon as the payment is confirmed on-chain, usually within seconds.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Changing plans</h3><p>Plans are prepaid for a month or a year, with no automatic renewal: you get a reminder 3 days before yours ends. Renewing early adds the time on top; upgrading turns your remaining days into days on the new plan.</p></div>
        <div><h3 className="mb-1 font-semibold text-fg">Nothing to cancel</h3><p>Since nothing renews automatically, there is no card on file and nothing to cancel: if you don&apos;t pay again, your plan returns to Free when it ends. Questions? <Link href="/contact" className="text-up">Contact support</Link>.</p></div>
      </div>
      <Disclaimer className="mt-10" />
    </Section>
  );
}
