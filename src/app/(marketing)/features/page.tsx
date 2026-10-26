import type { Metadata } from "next";
import { FeatureCard, Icons, Section } from "@/components/marketing/sections";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Features", description: "Live signals, explainable AI scores, token security, wallet intelligence, alerts and portfolio tracking across four chains." };

const GROUPS: { title: string; intro: string; items: [keyof typeof Icons, string, string, "up" | "ai" | "down" | "info"][] }[] = [
  {
    title: "Signals & discovery",
    intro: "One centralized engine scans every chain and shares the results with all users.",
    items: [
      ["radar", "Live signal feed", "Momentum, accumulation, breakout-watch, distribution and high-risk signals with filters for chain, score, liquidity, volume, market cap, age and price change."],
      ["rocket", "New launches", "Fresh pairs across chains, deduplicated by chain and contract, with liquidity thresholds and security status."],
      ["chart", "Token screener", "Every tracked token with sortable metrics, volume acceleration, buy/sell share and security filters."],
      ["chart", "Token pages", "Candlestick charts, 5m–24h metrics, liquidity pairs, factor breakdowns, scenario levels and full security reports."],
    ].map(([i, t, d]) => [i, t, d, "up"]) as never,
  },
  {
    title: "Analysis you can audit",
    intro: "Deterministic scores; AI explains, never invents.",
    items: [
      ["brain", "Explainable scoring", "Separate quality, momentum, risk and confidence scores from eleven documented, weighted factors — with evidence and missing data."],
      ["chat", "AI chat", "Ask about tokens, signals, wallets and markets. Answers are grounded in retrieved data and cite timestamps."],
      ["brain", "Deep research reports", "One-click reports covering snapshot, score drivers, security, liquidity, track record, scenarios and data gaps."],
      ["chart", "Measured track record", "Signal History records observed returns 1h, 6h and 24h after each signal — including losses."],
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
      ["bell", "Eight alert types", "Price crosses, % moves, volume spikes, liquidity drops, new signals, security changes and wallet activity — in-app, email and Telegram."],
      ["chart", "Portfolio", "Manual positions with partial exits, fees, stop-loss and take-profits; realized/unrealized P&L, win rate, drawdown, equity curve and CSV export."],
      ["rocket", "Strategy templates", "Pre-built research workflows that apply filters in one click."],
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
