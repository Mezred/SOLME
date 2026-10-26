import type { Metadata } from "next";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";

export const metadata: Metadata = { title: "Strategy Templates" };

interface Template {
  name: string;
  thesis: string;
  rules: string[];
  risks: string;
  href: string;
  pro?: boolean;
  tone: "up" | "info" | "ai" | "down" | "warn";
}

const TEMPLATES: Template[] = [
  {
    name: "Confirmed momentum, liquid only",
    thesis: "Trend continuation where price expansion is confirmed by buy-side flow and volume, restricted to pools deep enough to exit.",
    rules: ["Signal type: momentum", "AI score ≥ 70, confidence ≥ 60", "Liquidity ≥ $250k, 24h volume ≥ $500k", "Pair older than 24h"],
    risks: "Momentum fades quickly in thin markets; late entries after extended moves carry the most downside.",
    href: "/app/signals?type=momentum&minScore=70&minConfidence=60&minLiquidity=250000&minVolume=500000",
    pro: true,
    tone: "up",
  },
  {
    name: "Quiet accumulation",
    thesis: "Persistent buy pressure while price stays flat can precede repricing — or simply reflect many small buys against a few large sells.",
    rules: ["Signal type: accumulation", "AI score ≥ 60", "Low security risk"],
    risks: "Transaction counts are not size-weighted; verify with holder concentration and liquidity changes.",
    href: "/app/signals?type=accumulation&minScore=60",
    tone: "info",
  },
  {
    name: "Breakout watchlist",
    thesis: "Volume building while price compresses. These are setups to watch, not entries.",
    rules: ["Signal type: breakout watch", "Liquidity ≥ $100k"],
    risks: "Compression can resolve in either direction.",
    href: "/app/signals?type=breakout_watch&minLiquidity=100000",
    pro: true,
    tone: "ai",
  },
  {
    name: "Fresh launches, cleaner security",
    thesis: "New pairs that pass available automated checks and already have meaningful liquidity.",
    rules: ["Pair age ≤ 72h", "Liquidity ≥ $50k", "Security risk: low or medium"],
    risks: "The highest-risk segment of the market. Liquidity can be pulled; automated checks miss some traps.",
    href: "/app/screener?maxAgeHours=72&minLiquidity=50000&risk=low,medium&sort=age",
    pro: true,
    tone: "warn",
  },
  {
    name: "Unusual volume, established tokens",
    thesis: "Older tokens suddenly trading far above their normal hourly volume often precede news or repricing.",
    rules: ["Pair age ≥ 30 days", "Liquidity ≥ $500k", "Sorted by volume acceleration"],
    risks: "Volume spikes can be exits as easily as entries — check buy/sell imbalance.",
    href: "/app/screener?minAgeHours=720&minLiquidity=500000&sort=volume_accel",
    pro: true,
    tone: "info",
  },
  {
    name: "Avoid list",
    thesis: "Tokens currently showing distribution or high-risk conditions — useful for checking what you hold.",
    rules: ["Signal type: distribution or high risk"],
    risks: "Absence from this list does not mean a token is safe.",
    href: "/app/signals?type=distribution,high_risk",
    tone: "down",
  },
];

export default async function StrategiesPage() {
  const user = await requirePageUser("/app/strategies");
  const ent = await getEntitlements(user.id);
  return (
    <>
      <PageHeader title="Strategy Templates" description="Pre-built filter sets for common research workflows. Each opens the screener or signal feed with its rules applied — you can then refine and set alerts. Templates organize research; they are not trading recommendations." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => {
          const locked = t.pro && !ent.features.advanced_filters;
          return (
            <Card key={t.name} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{t.name}</h2>
                {t.pro && <Badge tone="ai">Pro filters</Badge>}
              </div>
              <p className="mt-2 text-sm text-fg-muted">{t.thesis}</p>
              <ul className="mt-3 space-y-1 text-xs text-fg-muted">{t.rules.map((r) => <li key={r} className="flex gap-1.5"><span className="text-up">›</span>{r}</li>)}</ul>
              <p className="mt-3 text-xs text-warn">Risk: {t.risks}</p>
              <div className="mt-auto flex gap-2 pt-4">
                <ButtonLink href={locked ? "/app/billing" : t.href} variant={locked ? "secondary" : "primary"} size="sm">{locked ? "Requires Pro" : "Apply template"}</ButtonLink>
                <ButtonLink href="/app/alerts" size="sm" variant="ghost">Set alert</ButtonLink>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
