import type { Metadata } from "next";
import { Section } from "@/components/marketing/sections";
import { Badge, Card } from "@/components/ui";
import { FACTOR_DOCS, SCORING_VERSION } from "@/lib/scoring/engine";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Scoring methodology", description: "Every factor, weight and rule behind SOLME scores and the pre-buy check." };
export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const s = await getSetting("scoring");
  const total = Object.values(s.weights).reduce((a, b) => a + b, 0) || 1;
  return (
    <Section as="h1" eyebrow={`Scoring ${s.version || SCORING_VERSION}`} title="Scoring methodology" intro="SOLME scores are deterministic and reproducible. This page renders the live configuration used by the engine.">
      <div className="space-y-8">
        <Card className="overflow-x-auto">
          <table className="table-terminal">
            <thead><tr><th>Factor</th><th>Category</th><th className="text-right">Weight</th><th>How it is scored</th><th>Inputs</th></tr></thead>
            <tbody>
              {Object.entries(FACTOR_DOCS).map(([k, d]) => (
                <tr key={k}>
                  <td className="font-medium">{d.label}</td>
                  <td><Badge tone={d.category === "momentum" ? "up" : d.category === "quality" ? "info" : "ai"}>{d.category}</Badge></td>
                  <td className="num text-right">{(((s.weights[k] ?? 0) / total) * 100).toFixed(0)}%</td>
                  <td className="min-w-[320px] whitespace-normal text-xs text-fg-muted">{d.description}</td>
                  <td className="text-xs text-fg-faint">{d.inputs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-5 text-sm text-fg-muted">
            <h3 className="mb-2 font-semibold text-fg">Combining factors</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><b>Quality</b> and <b>momentum</b> are weighted means of their factors.</li>
              <li>The <b>AI score</b> is the weighted mean of all available factors, then adjusted for security: critical findings cap it at {Math.max(0, 100 - s.security_penalty.critical) + 15}; high risk −{s.security_penalty.high}; medium −{s.security_penalty.medium}; unverified −{s.security_penalty.unknown}.</li>
              <li><b>Risk</b> starts from the security level (low 10, medium 35, high 65, critical 95, unverified 50) plus penalties for pairs under 1 hour, liquidity below ${s.thresholds.min_liquidity_usd.toLocaleString()}, parabolic moves and thin liquidity.</li>
              <li><b>Confidence</b> is the share of factor weight with data, halved for stale data (&gt;{s.thresholds.stale_after_minutes} min) and reduced 15 points when security is unverified.</li>
            </ul>
          </Card>
          <Card className="p-5 text-sm text-fg-muted">
            <h3 className="mb-2 font-semibold text-fg">Patterns</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><b>Momentum</b>: momentum ≥ 65, ≥55% buys, volume acceleration ≥ 60, and ≥3% hourly expansion.</li>
              <li><b>Accumulation</b>: ≥58% buys while 1h price moves &lt;3% and 24h stays between −10% and +15%.</li>
              <li><b>Breakout watch</b>: strong volume acceleration while 1h price stays within ±3%.</li>
              <li><b>Distribution</b>: ≤42% buys with rising volume and falling price. <b>High risk</b>: critical security or risk ≥ 75.</li>
              <li>A pattern only counts (is eligible) with liquidity ≥ ${s.thresholds.min_liquidity_usd.toLocaleString()}, 24h volume ≥ ${s.thresholds.min_volume_h24_usd.toLocaleString()}, fresh data and confidence ≥ {s.thresholds.min_confidence}. Bullish ones also need score ≥ {s.thresholds.min_score}, no high security risk, a pair older than 1 hour, and no parabolic move.</li>
            </ul>
          </Card>
        </div>
        <Card className="p-5 text-sm text-fg-muted">
          <h3 className="mb-2 font-semibold text-fg">Limitations</h3>
          <p>Known limitations: transaction counts are not trade sizes; DEX data excludes centralized exchanges; 7-day change and some holder data are not available from current providers; security checks cannot detect every malicious mechanism; measured outcomes ignore fees and slippage.</p>
        </Card>
      </div>
    </Section>
  );
}
