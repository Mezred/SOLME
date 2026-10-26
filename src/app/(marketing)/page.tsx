import Link from "next/link";
import { FAQ } from "@/content/faq";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { ChainStrip, FeatureCard, Icons, Section } from "@/components/marketing/sections";
import { TerminalPreview } from "@/components/marketing/terminal-preview";
import { Badge, ButtonLink, Disclaimer, ScoreBar } from "@/components/ui";
import { getPreviewRows, getPricingPlans } from "@/lib/data/marketing";
import { listPlans } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", t: "Discover", d: "Trending pools, new pairs and promoted listings are pulled from DexScreener and GeckoTerminal for all four chains — once, centrally, for every user." },
  { n: "02", t: "Enrich", d: "Each token's deepest pair is snapshotted: price, 5m–24h changes, volume, liquidity, FDV, buy/sell counts and pair age. Obvious junk is filtered." },
  { n: "03", t: "Verify", d: "GoPlus security checks run chain-specific tests — honeypot simulation, taxes, mint & freeze authority, ownership, holder concentration — with timestamps." },
  { n: "04", t: "Score & explain", d: "Eleven documented factors produce separate quality, momentum, risk and confidence scores. Only patterns with real confirmation become signals." },
];

const FACTORS: [string, number, string][] = [
  ["Buy/sell imbalance", 84, "71% of last-hour transactions are buys"],
  ["Volume acceleration", 77, "Last-hour volume 2.6× the 24h average"],
  ["Liquidity depth", 72, "$412k pooled liquidity"],
  ["Holder distribution", 64, "Top 10 holders own 27.3%"],
  ["Pair age", 35, "Pair is 19 hours old"],
];

export default async function HomePage() {
  const [{ rows, live }, pricing, plans] = await Promise.all([getPreviewRows(), getPricingPlans(), listPlans()]);
  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-line">
        <div className="grid-bg absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:pt-20">
          <div>
            <Badge tone="ai">Solana · Ethereum · BNB Chain · Base</Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Scan every new pair.
              <br />
              <span className="text-up">Trust only the evidence.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
              NEXALPHA watches DEX markets across four chains, runs security checks, and scores tokens with an engine that shows its work — every factor, every
              missing data point, every risk flag. AI explains the evidence; it never invents it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" variant="primary" size="lg">
                Start free — no card
              </ButtonLink>
              <ButtonLink href="#terminal" variant="secondary" size="lg">
                See the live terminal
              </ButtonLink>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
              {[
                ["4", "chains scanned"],
                ["11", "documented factors"],
                ["0", "invented data points"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="num text-2xl font-semibold">{v}</dt>
                  <dd className="text-xs text-fg-faint">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div id="terminal" className="scroll-mt-20">
            <TerminalPreview rows={rows} live={live} />
          </div>
        </div>
      </div>

      <Section eyebrow="Coverage" title="Four networks, one terminal" intro="Native Solana support plus a chain registry for EVM networks — adding another EVM chain is configuration, not a rewrite.">
        <ChainStrip />
      </Section>

      <Section id="engine" eyebrow="Scanning engine" title="From raw pairs to explainable signals" className="border-t border-line">
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="card relative p-5">
              <span className="num text-xs text-up">{s.n}</span>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-3xl text-sm text-fg-faint">
          A rising price on its own never produces a signal. Momentum requires buy-side confirmation and volume; pairs younger than an hour and parabolic moves are
          held back; failed security checks cap the score.
        </p>
      </Section>

      <Section eyebrow="AI analysis" title="Scores you can audit" intro="Quality, momentum, risk and confidence are reported separately. Open any signal to see each factor's score, weight and the raw evidence behind it." className="border-t border-line">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Factor breakdown</span>
              <Badge>Example</Badge>
            </div>
            <ul className="mt-4 space-y-3.5">
              {FACTORS.map(([name, score, ev]) => (
                <li key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{name}</span>
                    <span className="num text-fg-muted">{score}</span>
                  </div>
                  <ScoreBar score={score} />
                  <p className="mt-1 text-xs text-fg-faint">{ev}</p>
                </li>
              ))}
              <li className="rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-fg-faint">
                Smart Money flow — <span className="text-warn">unavailable</span>: excluded from the score, not counted as zero.
              </li>
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard icon={Icons.brain} title="Grounded AI explanations" tone="ai">
              The assistant answers from retrieved snapshots, factors and security reports, cites timestamps, and says so when data is missing.
            </FeatureCard>
            <FeatureCard icon={Icons.chat} title="Ask, compare, report" tone="ai">
              Compare tokens, summarize wallet activity, explain a warning, or generate a research report from stored evidence.
            </FeatureCard>
            <FeatureCard icon={Icons.chart} title="Measured track record" tone="info">
              Signal History records each signal&apos;s observed price 1h, 6h and 24h later — wins and losses alike.
            </FeatureCard>
            <FeatureCard icon={Icons.radar} title="Configurable weights" tone="info">
              Factor weights, thresholds and filters live on the server and are versioned with every signal.
            </FeatureCard>
          </div>
        </div>
      </Section>

      <Section eyebrow="Wallet intelligence" title="Smart Money, without the guesswork" className="border-t border-line">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard icon={Icons.wallet} title="Track any public wallet">
            Watch transfers and swaps with transaction hashes and explorer links, powered by Helius and Alchemy.
          </FeatureCard>
          <FeatureCard icon={Icons.radar} title="Documented labels only">
            A wallet is only called a whale, fund or Smart Money when the label has a cited source — or you set it yourself.
          </FeatureCard>
          <FeatureCard icon={Icons.bell} title="Wallet alerts">
            Get notified when a tracked wallet buys, sells or moves a token — in-app, by email or Telegram.
          </FeatureCard>
        </div>
      </Section>

      <Section eyebrow="Security" title="Risk detection that admits its limits" className="border-t border-line">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">Security report · example</span>
              <Badge tone="down">High risk</Badge>
            </div>
            <ul className="divide-y divide-line text-sm">
              {[
                ["Honeypot simulation", "pass", "Sell simulation succeeded"],
                ["Sell tax", "warn", "12.0% tax"],
                ["Mint function", "warn", "Supply can be increased"],
                ["Blacklist function", "fail", "Addresses can be blacklisted"],
                ["Liquidity lock", "unavailable", "LP holder data not available"],
              ].map(([k, r, d]) => (
                <li key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>{k}</span>
                  <span className="flex items-center gap-2 text-xs text-fg-faint">
                    {d}
                    <Badge tone={r === "pass" ? "up" : r === "warn" ? "warn" : r === "fail" ? "down" : "neutral"}>{r}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-xs text-fg-faint">Provider: GoPlus · checked 4m ago · chain-specific checks</p>
          </div>
          <div className="space-y-4">
            <FeatureCard icon={Icons.shield} title="Chain-specific checks" tone="down">
              EVM: honeypot simulation, taxes, proxy, ownership, blacklist, pausable transfers. Solana: mint, freeze and balance authorities, Token-2022 fees and hooks.
            </FeatureCard>
            <FeatureCard icon={Icons.shield} title="“Unverified” is not “safe”" tone="down">
              When a provider returns nothing, the token is marked unverified and its confidence drops. Missing data is never shown as a clean report.
            </FeatureCard>
          </div>
        </div>
      </Section>

      <Section eyebrow="Portfolio & alerts" title="Track your trades. Get told when it matters." className="border-t border-line">
        <div className="grid gap-4 md:grid-cols-4">
          <FeatureCard icon={Icons.chart} title="Position tracking">Entries, partial exits, fees, stop-loss and multiple take-profits with average-cost P&amp;L.</FeatureCard>
          <FeatureCard icon={Icons.chart} title="Equity curve">Realized and unrealized P&amp;L, win rate and drawdown once there is enough history. CSV export.</FeatureCard>
          <FeatureCard icon={Icons.bell} title="Eight alert types">Price crosses, % moves, volume spikes, liquidity drops, new signals, security warnings and wallet activity.</FeatureCard>
          <FeatureCard icon={Icons.rocket} title="No keys, no deposits">Read-only research software. Manual positions are clearly labeled as user-reported.</FeatureCard>
        </div>
      </Section>

      <Section eyebrow="Compare plans" title="Feature comparison" className="border-t border-line">
        <div className="card overflow-x-auto">
          <table className="table-terminal min-w-[640px]">
            <thead>
              <tr>
                <th>Feature</th>
                {plans.map((p) => (
                  <th key={p.id} className="text-center">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Chains", (f) => f.chains.length],
                  ["Signal delay", (f) => (f.signal_delay_minutes ? `${f.signal_delay_minutes} min` : "None")],
                  ["Signal history", (f) => `${f.signal_history_days} d`],
                  ["Advanced filters", (f) => f.advanced_filters],
                  ["Alert rules", (f) => f.max_alert_rules],
                  ["Email & Telegram alerts", (f) => f.alert_channels.length > 1],
                  ["AI requests / day", (f) => f.ai_daily_requests],
                  ["AI deep analysis", (f) => f.ai_deep_analysis],
                  ["Tracked wallets", (f) => f.max_tracked_wallets || false],
                  ["Smart Money & whale alerts", (f) => f.smart_money && f.whale_alerts],
                  ["CSV export", (f) => f.csv_export],
                  ["Priority support", (f) => f.priority_support],
                ] as [string, (f: (typeof plans)[number]["features"]) => string | number | boolean][]
              ).map(([label, get]) => (
                <tr key={label}>
                  <td className="text-fg-muted">{label}</td>
                  {plans.map((p) => {
                    const v = get(p.features);
                    return (
                      <td key={p.id} className="num text-center">
                        {v === true ? <span className="text-up">✓</span> : v === false ? <span className="text-fg-faint">—</span> : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="Start free. Upgrade when the edge is worth it." className="border-t border-line">
        <PricingCards plans={pricing} />
      </Section>

      <Section eyebrow="FAQ" title="Straight answers" className="border-t border-line">
        <div className="grid gap-3 md:grid-cols-2">
          {FAQ.slice(0, 6).map((f) => (
            <details key={f.q} className="card group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {f.q}
                  <span className="text-fg-faint transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.a}</p>
            </details>
          ))}
        </div>
        <Link href="/faq" className="mt-5 inline-block text-sm text-up hover:underline">
          All questions →
        </Link>
      </Section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="card grid-bg relative overflow-hidden px-6 py-12 text-center sm:px-12">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Research faster. Verify everything.</h2>
            <p className="mx-auto mt-3 max-w-xl text-fg-muted">Free forever on two chains with a 15-minute delay. Upgrade for real-time multi-chain signals, deep AI analysis and wallet intelligence.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/signup" variant="primary" size="lg">
                Create free account
              </ButtonLink>
              <ButtonLink href="/methodology" variant="secondary" size="lg">
                Read the methodology
              </ButtonLink>
            </div>
            <Disclaimer className="mx-auto mt-8 max-w-2xl" />
          </div>
        </div>
      </section>
    </>
  );
}
