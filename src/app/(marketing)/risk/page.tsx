import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Risk Disclaimer" };

export default function RiskPage() {
  return (
    <LegalPage title="Risk Disclaimer" updated="October 26, 2026">
      <p><strong>Crypto assets are highly volatile and speculative. You can lose all of the money you put into them.</strong></p>
      <h2>Research, not advice</h2>
      <p>SOLME provides informational research tools: market data, deterministic scores, pre-buy checks, security checks and wallet activity. Nothing on SOLME is financial, investment, legal or tax advice, a recommendation to buy or sell any asset, or a guarantee of any outcome. You are solely responsible for your decisions.</p>
      <h2>No promised performance</h2>
      <p>We do not promise any win rate, return or profit. Past behaviour of a token, wallet or dev does not predict future results.</p>
      <h2>Data limitations</h2>
      <ul>
        <li>Market data comes from third-party providers and may be delayed, incomplete, inaccurate or unavailable. Every page shows data age; stale data is labeled.</li>
        <li>DEX data excludes centralized exchanges. Transaction counts do not reflect trade sizes.</li>
        <li>Security checks are automated and cannot detect every malicious mechanism. A missing check is shown as “unverified”, never as safe. A passed check does not mean a token is safe.</li>
        <li>Wallet labels are shown only with a documented source or your own label, and may still be wrong.</li>
      </ul>
      <h2>Specific risks of DEX tokens</h2>
      <ul>
        <li>Liquidity can be withdrawn suddenly (“rug pulls”); new tokens carry the highest risk.</li>
        <li>Contracts can contain honeypots, taxes, blacklists, upgradeable logic or mint functions.</li>
        <li>Prices can be manipulated with wash trading, promotions and coordinated activity. Paid promotions are not a sign of quality.</li>
        <li>Smart contracts, bridges and wallets can be exploited; transactions are irreversible.</li>
      </ul>
      <h2>Your responsibilities</h2>
      <p>Only risk funds you can afford to lose, do your own research, and comply with the laws and tax rules of your jurisdiction. Crypto assets may be restricted where you live.</p>
    </LegalPage>
  );
}
