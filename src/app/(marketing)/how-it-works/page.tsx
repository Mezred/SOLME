import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/marketing/sections";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "How it works", description: "How SOLME ingests DEX data, checks security, scores tokens and tracks proven devs." };

const STAGES = [
  { t: "1 · Centralized ingestion", b: "About every two minutes a background worker pulls trending pools, new pairs and listings from DexScreener and GeckoTerminal for Solana. Tokens on users' watchlists are always refreshed. Requests are rate-limited, cached and deduplicated — we never fan out per user." },
  { t: "2 · Normalize & filter", b: "Each token is identified by chain + normalized contract address. We keep its deepest-liquidity pair and store a timestamped snapshot. Listings with no price, impersonated tickers, implausible valuations or anomalous data are flagged as spam." },
  { t: "3 · Security checks", b: "Liquid tokens are checked with GoPlus Security plus our own on-chain reads (mint and freeze authority, Token-2022 traps, LP burned or locked), refreshed every few hours. Every report records provider, time, unavailable checks and limitations." },
  { t: "4 · Deterministic scoring", b: "Eleven factors produce quality, momentum, risk and confidence scores. Missing data is excluded, not guessed. Security findings cap or reduce the score." },
  { t: "5 · Proven devs", b: "Every pump.fun and LetsBonk launch is recorded with its creator. Creators whose earlier launches migrated get a dev score; their new launches are shown within seconds and scam-checked in the background." },
  { t: "6 · Alert", b: "Proven-dev launches, smart-wallet buys and sells, group buys and Early Coins matches go to Telegram within seconds, each with the coin's scam check." },
];

export default function HowItWorksPage() {
  return (
    <Section as="h1" eyebrow="Pipeline" title="How SOLME works" intro="An honest pipeline: real provider data in, documented rules applied, evidence shown at every step.">
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
        <p className="mt-2">Data refreshes each ingestion cycle, not tick-by-tick. Every page shows how old its data is and labels anything stale. The Free plan is delayed 15 minutes. See the <Link href="/methodology" className="text-up">methodology</Link> for formulas.</p>
      </div>
    </Section>
  );
}
