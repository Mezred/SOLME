import type { Metadata } from "next";
import { Section } from "@/components/marketing/sections";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <Section as="h1" eyebrow="About" title="Built for traders who check the evidence" intro="NEXALPHA exists because most token scanners hand you a number without telling you where it came from.">
      <div className="max-w-3xl space-y-5 text-fg-muted">
        <p>DEX markets move fast and are full of noise: fake tickers, wash volume, honeypots and promoted listings. We built a terminal that is fast enough to keep up and transparent enough to trust — every score breaks down into documented factors, every security finding names its provider and time, and every missing data point is shown as missing.</p>
        <p>Our principles are simple. We use real provider data and say when it is unavailable. We never label a wallet without a source. The AI explains the evidence; it doesn&apos;t invent prices or promise returns. And we publish how past signals actually performed — good and bad.</p>
        <p>NEXALPHA is research software. We don&apos;t hold funds, ask for keys or execute trades.</p>
        <div className="flex gap-3 pt-2"><ButtonLink href="/methodology" variant="secondary">Read the methodology</ButtonLink><ButtonLink href="/contact" variant="ghost">Contact us</ButtonLink></div>
      </div>
    </Section>
  );
}
