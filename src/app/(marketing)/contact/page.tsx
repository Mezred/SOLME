import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/contact-form";
import { Section } from "@/components/marketing/sections";

export const metadata: Metadata = { title: "Contact & support" };

export default function ContactPage() {
  return (
    <Section as="h1" eyebrow="Support" title="Contact & support" intro="Questions about your account, billing, data or a signal? Send us a message.">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <ContactForm />
        <div className="space-y-4 text-sm text-fg-muted">
          <div className="card p-5"><h3 className="font-semibold text-fg">Before you write</h3><ul className="mt-2 list-disc space-y-1 pl-5"><li>Signal questions: open the token page — the factor breakdown usually answers “why”.</li><li>Billing: manage plans and invoices on the Billing page.</li><li>Security concerns about a token: check the security panel’s provider and limitations.</li></ul></div>
          <div className="card p-5"><h3 className="font-semibold text-fg">We will never</h3><p className="mt-2">Ask for your seed phrase, private keys or exchange credentials, or DM you with “investment opportunities”. Report impersonators.</p></div>
          <p>See also the <Link href="/faq" className="text-up">FAQ</Link>.</p>
        </div>
      </div>
    </Section>
  );
}
