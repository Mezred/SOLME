import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth/guard";
import { integrations } from "@/lib/env";
import { formatDateTime, timeAgo } from "@/lib/format";
import { listProviderStatus } from "@/lib/providers/health";

export const metadata: Metadata = { title: "API providers" };

const ROLES: Record<string, string> = {
  dexscreener: "Market pairs, prices, volume, liquidity, txns (keyless)",
  geckoterminal: "OHLCV candles, trending & new pools (keyless, ~10 req/min)",
  goplus: "Token security checks (keyless; GOPLUS_APP_KEY raises limits)",
  helius: "Solana wallet activity (HELIUS_API_KEY)",
  alchemy: "Ethereum/Base wallet transfers (ALCHEMY_API_KEY)",
  anthropic: "AI chat & reports (ANTHROPIC_API_KEY)",
  stripe: "Subscriptions & payments (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)",
  resend: "Transactional email (RESEND_API_KEY)",
  telegram: "Telegram alerts (TELEGRAM_BOT_TOKEN)",
};

export default async function AdminProviders() {
  await requirePageAdmin();
  const rows = await listProviderStatus();
  return (
    <>
      <PageHeader title="API provider health" description="Aggregated from live requests made by the ingestion worker and API routes. Counters are cumulative since the row was created." />
      <Card>
        <div className="overflow-x-auto"><table className="table-terminal">
          <thead><tr><th>Provider</th><th>Role</th><th>Status</th><th className="text-right">OK</th><th className="text-right">Errors</th><th className="text-right">Latency</th><th>Last success</th><th>Last error</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.provider}>
              <td className="font-medium">{p.provider}</td>
              <td className="max-w-xs whitespace-normal text-xs text-fg-muted">{ROLES[p.provider] ?? ""}</td>
              <td><Badge tone={p.status === "healthy" ? "up" : p.status === "degraded" ? "warn" : p.status === "down" ? "down" : "neutral"}>{p.status}</Badge></td>
              <td className="num text-right">{p.success_count}</td>
              <td className="num text-right">{p.error_count}</td>
              <td className="num text-right">{p.latency_ms !== null ? `${p.latency_ms}ms` : "—"}</td>
              <td className="text-xs" title={formatDateTime(p.last_success_at)}>{timeAgo(p.last_success_at)}</td>
              <td className="max-w-sm truncate text-xs text-down" title={p.last_error ?? undefined}>{p.last_error ? `${timeAgo(p.last_error_at)}: ${p.last_error}` : ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Configured integrations" />
        <div className="flex flex-wrap gap-2 p-4">{Object.entries(integrations).map(([k, v]) => <Badge key={k} tone={v === false ? "neutral" : "up"}>{k}: {String(v)}</Badge>)}</div>
      </Card>
    </>
  );
}
