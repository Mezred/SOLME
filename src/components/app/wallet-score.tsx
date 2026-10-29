import { TrackCandidateButton } from "@/components/app/wallet-forms";
import { Badge, Card, CardHeader, EmptyState, Notice, ScoreRing, Stat } from "@/components/ui";
import { CHAINS } from "@/lib/chains";
import { formatNumber, shortAddress, timeAgo } from "@/lib/format";
import { MIN_DECIDED } from "@/lib/wallets/scoring";

/** Presentation for on-chain wallet scores (src/lib/wallets/scoring.ts). Solana only. */

export const formatSol = (v: number | null | undefined, signed = true) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${signed && v > 0 ? "+" : ""}${formatNumber(v, Math.abs(v) >= 100 ? 0 : 2)} SOL`;
const solTone = (v: number | null | undefined) => (v === null || v === undefined ? "text-fg-faint" : v >= 0 ? "text-up" : "text-down");

export function formatDelay(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const winRate = (wins: number, decided: number) => (decided > 0 ? `${Math.round((wins / decided) * 100)}%` : "—");

export const SCORE_DISCLAIMER =
  "Scores describe this wallet's past swaps over 30 days from on-chain data: win rate (positions held to near zero count as losses), realized SOL profit, how often it bought within an hour of launch and later reached 2×, and profit factor. Bot-like wallets are discounted. It is not a classification and not advice.";

export interface WalletScoreRow {
  score: number | null;
  scored_at: Date;
  trades: number;
  decided_positions: number;
  open_positions: number;
  wins: number;
  losses: number;
  pnl_sol: number;
  early_entries: number;
  early_hits: number;
  median_hold_minutes: number | null;
  bot_like: boolean;
  covered_from: Date | null;
  metrics: {
    error?: string;
    truncated?: boolean;
    components?: { winRate: number; profit: number; early: number; consistency: number } | null;
    positions?: { mint: string; symbol: string | null; status: "closed" | "dead" | "open"; buys: number; sells: number; solIn: number; solOut: number; pnlSol: number | null; multiple: number | null; entryDelaySeconds: number | null; early: boolean; hit: boolean }[];
  };
}

export function WalletScoreCard({ s }: { s: WalletScoreRow | null }) {
  const header = <CardHeader title="On-chain score · 30d" subtitle={s ? `From Helius history · scored ${timeAgo(s.scored_at)}` : "From Helius history"} />;
  if (!s) return <Card>{header}<EmptyState title="Not scored yet" body="Tracked Solana wallets are scored by the background worker within about 10 minutes." /></Card>;
  if (s.metrics.error) return <Card>{header}<div className="p-4"><Notice tone="down" title="Scoring failed">{s.metrics.error}</Notice></div></Card>;
  const positions = s.metrics.positions ?? [];
  const c = s.metrics.components;
  return (
    <Card>
      {header}
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3">
        <ScoreRing score={s.score} size={56} label="Wallet score" />
        <div className="text-sm">
          {s.score === null ? (
            <span className="text-fg-muted">Insufficient history: {s.decided_positions} decided positions (needs {MIN_DECIDED}).</span>
          ) : (
            <span className="text-fg-muted">Win rate {c?.winRate} · Profit {c?.profit} · Early {c?.early} · Consistency {c?.consistency}</span>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {s.bot_like && <Badge tone="warn">bot-like · score discounted</Badge>}
            {s.metrics.truncated && <Badge title="Very active wallet: only the most recent transactions were read">partial window since {timeAgo(s.covered_from)}</Badge>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
        <Stat label="Realized + held PnL" value={<span className={solTone(s.pnl_sol)}>{formatSol(s.pnl_sol)}</span>} sub={`${s.decided_positions} decided positions`} />
        <Stat label="Win rate" value={winRate(s.wins, s.decided_positions)} sub={`${s.wins}W / ${s.losses}L · ${s.open_positions} open`} />
        <Stat label="Early hits" value={s.early_hits} sub={`${s.early_entries} entries within 1h of launch`} />
        <Stat label="Median hold" value={s.median_hold_minutes === null ? "—" : formatDelay(s.median_hold_minutes * 60)} sub={`${s.trades} swaps`} />
      </div>
      {positions.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="table-terminal">
            <thead><tr><th>Token</th><th>Status</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">PnL</th><th className="text-right">Multiple</th><th className="text-right">Entry after launch</th></tr></thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.mint}>
                  <td><span className="num" title={p.mint}>{p.symbol ?? shortAddress(p.mint)}</span>{p.hit && <Badge tone="up" className="ml-1.5">early hit</Badge>}</td>
                  <td><Badge tone={p.status === "dead" ? "down" : p.status === "open" ? "info" : "neutral"}>{p.status}</Badge></td>
                  <td className="num text-right">{formatSol(p.solIn, false)}</td>
                  <td className="num text-right">{formatSol(p.solOut, false)}</td>
                  <td className={`num text-right ${solTone(p.pnlSol)}`}>{formatSol(p.pnlSol)}</td>
                  <td className="num text-right">{p.multiple === null ? "—" : `${formatNumber(p.multiple, 2)}×`}</td>
                  <td className={`num text-right ${p.early ? "text-up" : "text-fg-muted"}`}>{formatDelay(p.entryDelaySeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
        {SCORE_DISCLAIMER} Stablecoin legs are converted at today&apos;s SOL price. Open positions are valued at the current DexScreener price; &quot;dead&quot; means no market or under 10% of cost after a day. Launch time is the token&apos;s primary pair creation, so bonding-curve buys before migration count as early.
      </p>
    </Card>
  );
}

export interface EarlyBuyerRow {
  id: string;
  address: string;
  entry_delay_seconds: number;
  entry_sol: number;
  score: number | null;
  pnl_sol: number | null;
  bot_like: boolean | null;
}

export function EarlyBuyersCard({ rows, launchAt }: { rows: EarlyBuyerRow[]; launchAt: Date | null }) {
  return (
    <Card>
      <CardHeader title="Early buyers" subtitle={`First-hour buyers after launch${launchAt ? ` (${timeAgo(launchAt)})` : ""}, excluding the creator and launch-slot bundles`} />
      <ul className="divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0">
              <a href={CHAINS.solana.explorerAddress(r.address)} target="_blank" rel="noopener noreferrer" className="num hover:text-up" title={r.address}>{shortAddress(r.address, 5)}</a>
              {r.bot_like && <Badge tone="warn" className="ml-1.5">bot-like</Badge>}
              <div className="text-[11px] text-fg-faint">+{formatDelay(r.entry_delay_seconds)} · {formatSol(r.entry_sol, false)} in</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {r.score !== null ? <ScoreRing score={r.score} size={30} label="Wallet score" /> : <span className="text-[10px] text-fg-faint">not scored</span>}
              <TrackCandidateButton chain="solana" address={r.address} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
