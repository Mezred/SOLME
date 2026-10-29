import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 26, 2026">
      <p>This policy explains what personal data SOLME (“we”) collects, why, and your choices. We collect only what we need to run the service.</p>
      <h2>Data we collect</h2>
      <ul>
        <li><strong>Account:</strong> email address, password hash (never your password itself), role, verification status, display name and timezone if you set them.</li>
        <li><strong>Security:</strong> session records with IP address and user-agent, and an audit log of sign-ins and sensitive changes, used to protect your account.</li>
        <li><strong>Your content:</strong> watchlists, saved screener templates, alert rules, mutes and quiet hours, notifications, and tracked public wallet addresses.</li>
        <li><strong>Billing:</strong> subscription status, and for each payment the public transaction signature and the paying wallet address read from the Solana blockchain. We never ask for or hold private keys or card details.</li>
        <li><strong>Optional:</strong> a Telegram chat ID if you enable Telegram alerts; support messages you send us.</li>
      </ul>
      <h2>Data we do not collect</h2>
      <p>We never ask for or store private keys, seed phrases, exchange API keys, or wallet signatures. We do not sell personal data or use third-party advertising trackers.</p>
      <h2>How we use data</h2>
      <p>To provide the service (authentication, alerts, coin checks, billing), to secure accounts and prevent abuse (rate limiting, audit logs), to provide support, and to send transactional emails. We use a strictly necessary session cookie; preferences such as sidebar state are stored in your browser.</p>
      <h2>Processors</h2>
      <p>We share data only with providers needed to operate: hosting and database providers, an email provider (transactional email), Telegram (if enabled), and blockchain data providers (Helius, DexScreener, GeckoTerminal, GoPlus), which receive token and public wallet addresses only, never your email or password.</p>
      <h2>Retention</h2>
      <p>Account data is kept while your account exists. Market snapshots are kept for a limited window; logs are pruned after 30 days. Payment records are kept as required by law.</p>
      <h2>Your rights</h2>
      <p>You can access and edit your data in the app and permanently delete your account in Account Settings. Depending on where you live you may have additional rights (access, correction, portability, objection); contact us to exercise them.</p>
      <h2>Contact</h2>
      <p>Use the contact form for privacy requests.</p>
    </LegalPage>
  );
}
