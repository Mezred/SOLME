import Link from "next/link";
import { Logo } from "@/components/brand";
import { Disclaimer } from "@/components/ui";

const COLS = [
  { title: "Product", links: [["/features", "Features"], ["/pricing", "Pricing"], ["/how-it-works", "How it works"], ["/methodology", "Scoring methodology"]] },
  { title: "Company", links: [["/about", "About"], ["/faq", "FAQ"], ["/contact", "Contact & support"]] },
  { title: "Legal", links: [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/risk", "Risk Disclaimer"]] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ink-900">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-5">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-fg-muted">
            Explainable on-chain research for DEX traders on Solana, Ethereum, BNB Smart Chain and Base.
          </p>
          <Disclaimer className="mt-4 max-w-sm" />
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-faint">{c.title}</h3>
            <ul className="mt-3 space-y-2">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-fg-muted hover:text-fg">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-fg-faint sm:px-6">
          <span>© {new Date().getFullYear()} NEXALPHA. All rights reserved.</span>
          <span>Market data: DexScreener, GeckoTerminal · Security: GoPlus · Not affiliated with any exchange.</span>
        </div>
      </div>
    </footer>
  );
}
