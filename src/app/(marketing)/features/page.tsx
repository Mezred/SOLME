import type { Metadata } from "next";
import { FeatureCard, Icons, Section } from "@/components/marketing/sections";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Features", description: "Early Coins, Coin Check, Proven Devs, scam checks, explainable scores, smart-wallet tracking and Telegram alerts for Solana memecoins." };

const GROUPS: { title: string; intro: string; items: [keyof typeof Icons, string, string, "up" | "ai" | "down" | "info"][] }[] = [
  {
    title: "Discovery",
    intro: "One centralized engine scans every chain and shares the results with all users.",
    items: [
      ["radar", "Proven Devs", "New launches from creators whose earlier coins migrated, each with a background scam check."],
      ["rocket", "New launches", "Fresh pairs across chains, deduplicated by chain and contract, with liquidity thresholds and security status."],
      ["chart", "Early Coins", "Fresh Solana coins where activity is rising against their own pace, classified as Early Activity, Building Momentum or High Risk, each with the signals that put it there."],
      ["chart", "Token pages", "Candlestick charts, 5m–24h metrics, liquidity pairs, factor breakdowns and full security reports."],
    ].map(([i, t, d]) => [i, t, d, "up"]) as never,
  },
  {
    title: "Analysis you can audit",
    intro: "Deterministic scores from documented rules.",
    items: [
      ["brain", "Explainable scoring", "Separate quality, momentum, risk and confidence scores from eleven documented, weighted factors — with evidence and missing data."],
      ["shield", "Coin Check", "Paste a contract on the site or send it to the Telegram bot: overall risk (Low, Moderate, High, Critical), the three findings that matter, and five plain questions: can I sell it, is the liquidity real, who controls it, are insiders set to dump, is the trading genuine."],
    ].map(([i, t, d]) => [i, t, d, "ai"]) as never,
  },
  {
    title: "Risk & security",
    intro: "Chain-specific checks with honest limits.",
    items: [
      ["shield", "Token security", "Honeypot simulation, buy/sell restrictions, taxes, mint/freeze authority, ownership, blacklist, proxy and holder concentration."],
      ["shield", "Unverified ≠ safe", "Missing provider results are labeled unverified and lower confidence; they are never shown as clean."],
      ["radar", "Spam filtering", "Impersonation, implausible valuations and anomalous data are filtered — without claiming to catch every scam."],
      ["bell", "Security alerts", "Get notified when a watched token's risk level rises."],
    ].map(([i, t, d]) => [i, t, d, "down"]) as never,
  },
  {
    title: "Tracking & alerts",
    intro: "Watch, record and get notified.",
    items: [
      ["wallet", "Whale tracker", "Follow public wallets' transfers and swaps. Classifications only with documented sources."],
      ["bell", "Eight alert types", "Price crosses, % moves, volume spikes, liquidity drops, proven-dev launches, curve milestones, security changes and wallet activity — in-app, email and Telegram."],
      ["rocket", "Watchlists", "Keep the coins you are watching in one place, with live metrics and alerts."],
    ].map(([i, t, d]) => [i, t, d, "info"]) as never,
  },
];

export default function FeaturesPage() {
  return (
    <>
      {GROUPS.map((g, i) => (
        <Section key={g.title} as={i === 0 ? "h1" : "h2"} eyebrow={`0${i + 1}`} title={g.title} intro={g.intro} className={i ? "border-t border-line" : ""}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {g.items.map(([icon, title, desc, tone]) => <FeatureCard key={title} icon={Icons[icon]} title={title} tone={tone}>{desc}</FeatureCard>)}
          </div>
        </Section>
      ))}
      <div className="pb-16 text-center"><ButtonLink href="/signup" variant="primary" size="lg">Start free</ButtonLink></div>
    </>
  );
}
