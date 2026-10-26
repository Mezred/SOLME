import type { Metadata } from "next";
import { Section } from "@/components/marketing/sections";
import { FAQ } from "@/content/faq";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <Section as="h1" eyebrow="FAQ" title="Frequently asked questions">
      <div className="max-w-3xl space-y-3">
        {FAQ.map((f) => (
          <details key={f.q} className="card group p-4">
            <summary className="cursor-pointer list-none font-medium"><span className="flex items-center justify-between gap-3">{f.q}<span className="text-fg-faint transition-transform group-open:rotate-45" aria-hidden="true">+</span></span></summary>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.a}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        // Static content authored by us; JSON.stringify escapes it safely for a script context except "<", which we escape.
        dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }).replace(/</g, "\\u003c") }}
      />
    </Section>
  );
}
