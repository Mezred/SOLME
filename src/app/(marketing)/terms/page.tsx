import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 26, 2026">
      <p>By creating an account or using NEXALPHA you agree to these terms. If you do not agree, do not use the service.</p>
      <h2>1. The service</h2>
      <p>NEXALPHA is software for researching on-chain tokens. It does not custody assets, execute trades or provide investment advice. Read the <Link href="/risk">Risk Disclaimer</Link>, which forms part of these terms.</p>
      <h2>2. Eligibility & accounts</h2>
      <p>You must be of legal age in your jurisdiction and permitted to use crypto research tools there. Keep your credentials confidential; you are responsible for activity on your account.</p>
      <h2>3. Subscriptions & payments</h2>
      <ul>
        <li>Paid plans renew automatically each month or year until cancelled. Prices and features are shown on the Pricing page at purchase.</li>
        <li>Payments are processed by Stripe. Plan changes are prorated. Cancellation takes effect at the end of the current period; we do not provide refunds for partial periods except where required by law.</li>
        <li>If a payment fails, paid features may continue for a short grace period and then revert to the Free plan.</li>
      </ul>
      <h2>4. Acceptable use</h2>
      <p>Do not scrape or resell data, circumvent plan limits or security controls, overload the service, use it for market manipulation or unlawful activity, or impersonate others.</p>
      <h2>5. Data & third-party content</h2>
      <p>Data comes from third-party providers and blockchains and is provided “as is”, without warranty of accuracy, completeness or timeliness. Third-party trademarks belong to their owners.</p>
      <h2>6. AI features</h2>
      <p>AI responses are generated automatically from retrieved data and may be wrong. Do not rely on them as advice. Usage limits apply per plan.</p>
      <h2>7. Disclaimers & liability</h2>
      <p>The service is provided “as is” and “as available”. To the maximum extent permitted by law we disclaim all warranties and are not liable for trading losses, lost profits, or indirect damages. Our total liability is limited to the fees you paid in the three months before the claim.</p>
      <h2>8. Termination</h2>
      <p>You may delete your account at any time. We may suspend accounts that violate these terms.</p>
      <h2>9. Changes</h2>
      <p>We may update these terms; material changes will be announced in the app. Continued use means acceptance.</p>
    </LegalPage>
  );
}
