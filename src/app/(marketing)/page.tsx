import Link from "next/link";
import type { ReactNode } from "react";
import { FAQ } from "@/content/faq";
import { AlertShowcase } from "@/components/marketing/alert-showcase";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Icons, Section } from "@/components/marketing/sections";
import { NavIcon } from "@/components/app/nav-items";
import { ButtonLink, Disclaimer } from "@/components/ui";
import { getPricingPlans } from "@/lib/data/marketing";
import { CHAIN_IDS, CHAINS } from "@/lib/chains";

export const dynamic = "force-dynamic";

// Coverage copy comes from the chain registry so it never drifts when a chain is added.
const CHAIN_LIST = CHAIN_IDS.map((c) => CHAINS[c].name).join(" · ");

const FEATURES: { href: string; icon: ReactNode; title: string; body: string }[] = [
  { href: "/app/smart-dev", icon: Icons.rocket, title: "Proven Devs", body: "New coins from devs whose last launches migrated." },
  { href: "/app/screener", icon: Icons.chart, title: "Screener", body: "Filter every DEX pair. Save your setups." },
  { href: "/app/check", icon: Icons.shield, title: "Check a coin", body: "Paste a contract. Get Tradeable, Watch or Avoid." },
  { href: "/app/smart-money", icon: Icons.wallet, title: "Smart Wallets", body: "See what proven wallets are buying right now." },
  { href: "/app/alerts", icon: Icons.bell, title: "Alerts", body: "Get pinged on Telegram the moment it happens." },
];

const FAQ_KEYS = ["What is a proven dev?", "Does a passed security check mean a token is safe?", "Which blockchains are supported?", "Can I cancel anytime?"];

export default async function HomePage() {
  const pricing = await getPricingPlans();
  return (
    <>
      <div className="relative flex min-h-[calc(100svh-4rem)] flex-col border-b border-line">
        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-14 px-4 py-16 text-center sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:text-left">
          <div>
            <p className="num text-xs text-fg-faint">{CHAIN_LIST}</p>
            <h1 className="mt-4 font-display text-5xl font-bold leading-[1.02] tracking-tight text-fg sm:text-6xl xl:text-7xl">
              Find memecoins early.
              <br />
              <span className="text-up">Skip the scams.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-md text-fg-muted lg:mx-0">Proven-dev launches, scam checks and smart-wallet buys. One terminal.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
              <ButtonLink href="/signup" variant="primary" size="lg">
                Start free →
              </ButtonLink>
              <ButtonLink href="#features" variant="secondary" size="lg">
                See the features ↓
              </ButtonLink>
            </div>
            <p className="mt-6 text-xs text-fg-faint">Alerts land on Telegram within seconds, with the contract to copy and the scam check built in.</p>
          </div>
          <AlertShowcase />
        </div>
        <a href="#features" className="mx-auto mb-8 flex flex-col items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fg-faint hover:text-fg">
          See the features
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong">
            <NavIcon d="M6 9l6 6 6-6" className="h-4 w-4" />
          </span>
        </a>
      </div>

      <Section id="features" eyebrow="Features" title="Five tools. No noise." className="scroll-mt-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <Link key={f.title} href={f.href} className="card group p-5 transition-colors hover:border-up/60">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-up/10 text-up">{f.icon}</span>
              <h3 className="mt-4 flex items-center justify-between font-semibold text-fg">
                {f.title}
                <span className="text-fg-faint transition-colors group-hover:text-up" aria-hidden="true">→</span>
              </h3>
              <p className="mt-1.5 text-sm text-fg-muted">{f.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="Start free. Upgrade when it pays." className="border-t border-line">
        <PricingCards plans={pricing} />
      </Section>

      <Section eyebrow="FAQ" title="Quick answers" className="border-t border-line">
        <div className="grid gap-3 md:grid-cols-2">
          {FAQ.filter((f) => FAQ_KEYS.includes(f.q)).map((f) => (
            <details key={f.q} className="card group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {f.q}
                  <span className="text-fg-faint transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.a}</p>
            </details>
          ))}
        </div>
        <Link href="/faq" className="mt-5 inline-block text-sm text-up hover:underline">
          All questions →
        </Link>
      </Section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6">
          <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Spotted. Checked. <span className="text-up">Yours.</span>
          </h2>
          <div className="mt-8">
            <ButtonLink href="/signup" variant="primary" size="lg">
              Create free account →
            </ButtonLink>
          </div>
          <Disclaimer className="mx-auto mt-10 max-w-2xl" />
        </div>
      </section>
    </>
  );
}
