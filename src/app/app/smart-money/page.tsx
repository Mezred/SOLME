import type { Metadata } from "next";
import Link from "next/link";
import { formatSol } from "@/components/app/wallet-score";
import { TrackCandidateButton } from "@/components/app/wallet-forms";
import { Badge, Card, CardHeader, ChainBadge, EmptyState, Notice, PageHeader, UpgradeGate, VerdictBadge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query, queryOne } from "@/lib/db";
import { listDecision, type ListFacts } from "@/lib/decision/list";
import { integrations } from "@/lib/env";
import { formatPct, shortAddress, timeAgo } from "@/lib/format";
import { STORED_SCORE_COLUMNS } from "@/lib/scoring/stored";
import { WATCH_MIN_SCORE } from "@/lib/wallets/smart-money";

export const metadata: Metadata = { title: "Smart Wallets" };

interface BuyRow extends ListFacts {
  id: string;
  chain: string;
  token_address: string;
  wallet_id: string;
  symbol: string | null;
  token_id: string | null;
  address: string;
  score: number;
  wins: number;
  decided_positions: number;
  sol: number | null;
  block_time: Date;
}

interface WalletRow {
  id: string;
  address: string;
  score: number;
  wins: number;
  decided_positions: number;
  pnl_sol: number;
  early_hits: number;
  last_buy: Date | null;
  followed: boolean;
  oos_verdict: "held_up" | "faded" | "too_few" | null;
  copy_trades: number | null;
  copy_avg: number | null;
  copy_wins: number | null;
}

const winRate = (wins: number, decided: number) => (decided > 0 ? `${Math.round((wins / decided) * 100)}%` : "—");

export default async function SmartWalletsPage() {
  const user = await requirePageUser("/app/smart-money");
  const ent = await getEntitlements(user.id);
  const header = <PageHeader title="Smart Wallets" description="Wallets with a strong on-chain record, and what they are buying now. Open one to see how it trades, its results and what copying it would have returned. Past results don't repeat on their own." />;
  if (!ent.features.smart_money) return <>{header}<UpgradeGate feature="Smart wallets" plan="Elite" /></>;
  if (!integrations.helius) return <>{header}<Notice tone="warn">Smart wallets need HELIUS_API_KEY (Solana history).</Notice></>;

  const [buys, wallets, followed] = await Promise.all([
    query<BuyRow>(
      `SELECT x.id, x.chain, x.token_address, COALESCE(ta.symbol, x.token_symbol) AS symbol, ta.id AS token_id, w.address, w.id AS wallet_id,
              s.score, s.wins, s.decided_positions, (x.raw->>'sol')::numeric AS sol, x.block_time,
              snap.price_usd, snap.price_change_h1, snap.price_change_h6, snap.price_change_h24, snap.liquidity_usd, snap.buys_h1, snap.sells_h1,
              sec.risk_level AS security_risk, ${STORED_SCORE_COLUMNS.replaceAll("t.metadata", "ta.metadata")}
         FROM wallet_transactions x JOIN wallet_profiles w ON w.id = x.wallet_id JOIN wallet_scores s ON s.wallet_id = w.id
         LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
         LEFT JOIN LATERAL (SELECT * FROM market_snapshots m WHERE m.token_id = ta.id ORDER BY m.captured_at DESC LIMIT 1) snap ON true
         LEFT JOIN LATERAL (SELECT risk_level FROM token_security_checks c WHERE c.token_id = ta.id ORDER BY c.checked_at DESC LIMIT 1) sec ON true
        WHERE x.provider = 'helius-rpc' AND x.direction = 'buy' AND x.block_time > now() - interval '24 hours'
          AND s.score >= $1 AND NOT s.bot_like
        ORDER BY x.block_time DESC LIMIT 80`,
      [WATCH_MIN_SCORE],
    ),
    query<WalletRow>(
      `SELECT w.id, w.address, s.score, s.wins, s.decided_positions, s.pnl_sol, s.early_hits,
              (SELECT max(x.block_time) FROM wallet_transactions x WHERE x.wallet_id = w.id AND x.direction = 'buy') AS last_buy,
              EXISTS (SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = w.id AND t.user_id = $1) AS followed,
              s.oos_verdict, cs.trades AS copy_trades, cs.avg_return::float AS copy_avg, cs.wins AS copy_wins
         FROM wallet_scores s JOIN wallet_profiles w ON w.id = s.wallet_id
         LEFT JOIN wallet_copy_stats cs ON cs.wallet_id = w.id
        WHERE s.score >= $2 AND NOT s.bot_like AND EXISTS (SELECT 1 FROM smart_money_candidates c WHERE c.wallet_id = s.wallet_id)
        ORDER BY s.score DESC LIMIT 40`,
      [user.id, WATCH_MIN_SCORE],
    ),
    queryOne<{ n: number }>("SELECT count(*)::int AS n FROM user_tracked_wallets WHERE user_id = $1", [user.id]),
  ]);

  // Hide buys of coins that fail the scam pre-check: they are noise for a buyer.
  const checked = buys.map((b) => ({ ...b, d: listDecision(b) }));
  const shown = checked.filter((b) => b.d.verdict !== "avoid").slice(0, 30);
  const hidden = checked.length - checked.filter((b) => b.d.verdict !== "avoid").length;

  return (
    <>
      {header}
      <Card>
        <CardHeader
          title="Bought in the last 24h"
          subtitle={`By wallets scoring ${WATCH_MIN_SCORE}+${hidden ? ` · ${hidden} buy${hidden > 1 ? "s" : ""} hidden: the coin fails the scam check` : ""}`}
        />
        {shown.length === 0 ? (
          <EmptyState title="No qualifying buys in the last 24 hours" body="Buys appear within about 90 seconds of landing on-chain." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead><tr><th>Coin</th><th>Check</th><th>Wallet</th><th className="text-right">Win rate</th><th className="text-right">Spent</th><th className="text-right">When</th></tr></thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        {b.token_id ? (
                          <Link href={`/app/token/${b.chain}/${b.token_id}`} className="font-semibold hover:text-up">{b.symbol ?? shortAddress(b.token_address)}</Link>
                        ) : (
                          <Link href={`/app/check?q=${b.token_address}`} className="font-semibold hover:text-up">{b.symbol ?? shortAddress(b.token_address)}</Link>
                        )}
                        <ChainBadge chain={b.chain} />
                      </span>
                    </td>
                    <td>{b.token_id ? <VerdictBadge verdict={b.d.verdict} title={b.d.reasons.join("\n")} /> : <span className="text-xs text-fg-faint">not checked</span>}</td>
                    <td>
                      <Link href={`/app/wallets/${b.wallet_id}`} className="num hover:text-up" title="Open the wallet's profile">{shortAddress(b.address, 4)}</Link>
                      <span className="num ml-1.5 text-fg-faint">{b.score}</span>
                    </td>
                    <td className="num text-right">{winRate(b.wins, b.decided_positions)}</td>
                    <td className="num text-right">{formatSol(b.sol, false)}</td>
                    <td className="num text-right text-fg-muted">{timeAgo(b.block_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Proven wallets · Solana"
          subtitle="Early buyers of coins that pumped, scored on their other trades (not the pump we found them on) and checked against their last 10 days. Bots and launch insiders removed."
          action={<Link href="/app/wallets" className="text-xs text-fg-muted hover:text-up">Following {followed?.n ?? 0} →</Link>}
        />
        {wallets.length === 0 ? (
          <EmptyState title="No scored wallets yet" body="Wallets are found by scanning coins that pumped (every 30 minutes) and scored from their own history." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal">
              <thead><tr><th>Wallet</th><th className="text-right">Score</th><th className="text-right">Win rate</th><th className="text-right">PnL 30d</th><th className="text-right">Early hits</th><th className="text-right" title="Average result had you bought when SOLME saw each buy and sold when the wallet sold (or now, if still held). 30 days, no fees.">If you copied</th><th className="text-right">Last buy</th><th /></tr></thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id}>
                    <td><Link href={`/app/wallets/${w.id}`} className="num hover:text-up" title="Open the wallet's profile">{shortAddress(w.address, 5)}</Link></td>
                    <td className="num text-right">
                      {w.score}
                      {w.oos_verdict === "held_up" && <span className="ml-1.5"><Badge tone="up" title="Its last 10 days of trades, not used for the score, confirm it">held up</Badge></span>}
                      {w.oos_verdict === "faded" && <span className="ml-1.5"><Badge tone="warn" title="Its last 10 days of trades lost money: score cut by 30%">faded</Badge></span>}
                    </td>
                    <td className="num text-right">{winRate(w.wins, w.decided_positions)} <span className="text-fg-faint">({w.wins}/{w.decided_positions})</span></td>
                    <td className={`num text-right ${w.pnl_sol >= 0 ? "text-pos" : "text-down"}`}>{formatSol(w.pnl_sol)}</td>
                    <td className="num text-right">{w.early_hits}</td>
                    <td className="num text-right">
                      {w.copy_trades ? (
                        <span title={`${w.copy_wins}/${w.copy_trades} copied trades in profit`}>
                          <span className={(w.copy_avg ?? 0) >= 0 ? "text-pos" : "text-down"}>{formatPct(w.copy_avg, 0)}</span>
                          <span className="text-fg-faint"> · {w.copy_trades}</span>
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                    <td className="num text-right text-fg-muted">{timeAgo(w.last_buy)}</td>
                    <td className="text-right">{w.followed ? <span className="text-xs text-up">Following</span> : <TrackCandidateButton chain="solana" address={w.address} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 text-[11px] text-fg-faint">Scores describe past trades only. A smart wallet buying is a lead, not a reason: open the coin for the full scam check before you buy.</p>
    </>
  );
}
