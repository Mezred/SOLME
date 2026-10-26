import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/marketing/sections";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "How it works", description: "How NEXALPHA ingests DEX data, checks security, scores tokens and publishes signals." };

const STAGES = [
  { t: "1 · Centralized ingestion", b: "About every two minutes a background worker pulls trending pools, new pairs and listings from DexScreener and GeckoTerminal for Solana, Ethereum, BNB Smart Chain and Base. Tokens on users' watchlists and recent signals are always refreshed. Requests are rate-limited, cached and deduplicated — we never fan out per user." },
  { t: "2 · Normalize & filter", b: "Each token is identified by chain + normalized contract address. We keep its deepest-liquidity pair and store a timestamped snapshot. Listings with no price, impersonated tickers, implausible valuations or anomalous data are flagged as spam." },
  { t: "3 · Security checks", b: "Liquid tokens are checked with GoPlus Security, refreshed every few hours. EVM and Solana use different checks. Every report records provider, time, unavailable checks and limitations." },
  { t: "4 · Deterministic scoring", b: "Eleven factors produce quality, momentum, risk and confidence scores. Missing data is excluded, not guessed. Security findings cap or reduce the score." },
  { t: "5 · Signal rules", b: "A signal is published only when a documented pattern matches with enough liquidity, volume and confidence on fresh data. Bullish patterns need buy-side confirmation; pairs under an hour old and parabolic moves are held back. Duplicate signals are suppressed for a configurable window." },
  { t: "6 · Measure outcomes", b: "After publication we record the observed price 1h, 6h and 24h later from our own snapshots, and whether scenario levels were touched." },
  { t: "7 · Explain", b: "AI chat and reports retrieve this stored evidence through tools and explain it — with timestamps, uncertainty and no price predictions." },
];

export default function HowItWorksPage() {
  return (
    <Section eyebrow="Pipeline" title="How NEXALPHA works" intro="An honest pipeline: real provider data in, documented rules applied, evidence shown at every step.">
      <ol className="relative space-y-4 border-l border-line pl-6">
        {STAGES.map((s) => (
          <li key={s.t} className="card p-5">
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-up" aria-hidden="true" />
            <h3 className="font-semibold">{s.t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.b}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 card p-5 text-sm text-fg-muted">
        <Badge tone="warn">Freshness</Badge>
        <p className="mt-2">Signals refresh each ingestion cycle, not tick-by-tick. Every page shows how old its data is and labels anything stale. Free-plan signals are delayed 15 minutes. See the <Link href="/methodology" className="text-up">methodology</Link> for formulas.</p>
      </div>
    </Section>
  );
}
