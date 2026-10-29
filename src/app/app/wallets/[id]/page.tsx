import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TrackCandidateButton, UntrackWallet } from "@/components/app/wallet-forms";
import { formatSol, WalletScoreCard, type WalletScoreRow } from "@/components/app/wallet-score";
import { WalletTxTable, type WalletTxRow } from "@/components/app/wallet-tx-table";
import { Badge, Card, CardHeader, ChainBadge, cx, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS, type ChainId } from "@/lib/chains";
import { isUuid, query, queryOne, withUser } from "@/lib/db";
import { formatCompact, formatNumber, formatPct, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { errorMessage } from "@/lib/log";
import { walletProviderFor } from "@/lib/providers/wallets";
import { liveHoldings } from "@/lib/wallets/holdings";
import { copyAfterCosts, MODELED_COST_PCT, performanceConfidence, walletBehaviour, walletRisks } from "@/lib/wallets/profile";

export const metadata: Metadata = { title: "Wallet" };

interface WalletRow {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  classification: string;
  classification_source: string | null;
  source_url: string | null;
  last_synced_at: Date | null;
  custom_label: string | null;
  tracked: boolean;
}

/**
 * A wallet in plain language: how it trades, how it did over 30 days, what copying it would have returned after
 * modeled costs (kept apart from its own results), risks, recent activity, and how far the numbers can be trusted.
 * Followed wallets are visible to their follower; scored smart wallets to plans with Smart Wallets.
 */
export default async function WalletPage({ params }: PageProps<"/app/wallets/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/app/wallets/${id}`);
  if (!isUuid(id)) notFound();
  let w: WalletRow | null = await withUser(user.id, async (tx) =>
    (await tx.query<WalletRow>(
      `SELECT w.id, w.chain, w.address, w.label, w.classification, w.classification_source, w.source_url, w.last_synced_at, t.custom_label, (t.wallet_id IS NOT NULL) AS tracked
         FROM wallet_profiles w LEFT JOIN user_tracked_wallets t ON t.wallet_id = w.id AND t.user_id = $2 WHERE w.id = $1`,
      [id, user.id],
    ))[0] ?? null,
  );
  if (!w && (await getEntitlements(user.id)).features.smart_money) {
    w = await queryOne<WalletRow>(
      `SELECT w.id, w.chain, w.address, w.label, w.classification, w.classification_source, w.source_url, w.last_synced_at, NULL AS custom_label, false AS tracked
         FROM wallet_profiles w WHERE w.id = $1 AND EXISTS (SELECT 1 FROM smart_money_candidates c WHERE c.wallet_id = w.id)`,
      [id],
    );
  }
  if (!w) notFound();

  const [txs, exposure, score, copy] = await Promise.all([
    query<WalletTxRow>(
      `SELECT x.id, x.wallet_id, NULL AS wallet_label, x.chain, x.tx_hash, x.block_time, x.direction, x.token_address,
              COALESCE(x.token_symbol, ta.symbol) AS token_symbol, x.amount, x.provider, ta.id AS token_id
         FROM wallet_transactions x LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.wallet_id = $1 ORDER BY x.block_time DESC LIMIT 100`,
      [id],
    ),
    query<{ token_address: string; token_symbol: string | null; inflow: number; outflow: number; txs: number; last: Date }>(
      `SELECT x.token_address, max(COALESCE(x.token_symbol, ta.symbol)) AS token_symbol,
              sum(CASE WHEN x.direction IN ('buy', 'transfer_in') THEN x.amount ELSE 0 END)::float AS inflow,
              sum(CASE WHEN x.direction IN ('sell', 'transfer_out') THEN x.amount ELSE 0 END)::float AS outflow,
              count(*)::int AS txs, max(x.block_time) AS last
         FROM wallet_transactions x LEFT JOIN token_assets ta ON ta.chain = x.chain AND ta.address = x.token_address
        WHERE x.wallet_id = $1 AND x.token_address IS NOT NULL GROUP BY x.token_address ORDER BY last DESC LIMIT 20`,
      [id],
    ),
    queryOne<WalletScoreRow & { oos_verdict: "held_up" | "faded" | "too_few" | null; insider_reason: string | null }>("SELECT * FROM wallet_scores WHERE wallet_id = $1", [id]),
    queryOne<{ trades: number; closed: number; wins: number; avg_return: number | null; median_return: number | null; computed_at: Date }>(
      "SELECT trades, closed, wins, avg_return::float, median_return::float, computed_at FROM wallet_copy_stats WHERE wallet_id = $1",
      [id],
    ),
  ]);
  const provider = walletProviderFor(w.chain as ChainId);
  const lastActive = txs[0]?.block_time ?? null;
  const coveredDays = score?.covered_from ? Math.max(1, (new Date(score.scored_at).getTime() - new Date(score.covered_from).getTime()) / 86_400_000) : 30;
  const facts = score && score.score !== undefined
    ? {
        trades: score.trades, decided: score.decided_positions, wins: score.wins, pnlSol: Number(score.pnl_sol), earlyEntries: score.early_entries,
        medianHoldMinutes: score.median_hold_minutes, botLike: score.bot_like, coveredDays, oos: score.oos_verdict, insiderReason: score.insider_reason,
      }
    : null;
  const behaviour = facts ? walletBehaviour(facts) : null;
  const confidence = facts ? performanceConfidence(facts.decided) : null;
  const risks = facts ? walletRisks(facts) : [];
  const copyNet = copyAfterCosts(copy?.avg_return ?? null, copy?.trades ?? null);

  return (
    <>
      <PageHeader
        title={w.custom_label ?? w.label ?? shortAddress(w.address, 6)}
        badge={<>{behaviour && <Badge tone="ai">{behaviour.label}</Badge>} <ChainBadge chain={w.chain} /></>}
        description={<span className="num break-all">{w.address}</span>}
        actions={
          <>
            {w.tracked ? <UntrackWallet id={w.id} /> : <TrackCandidateButton chain="solana" address={w.address} />}
            <a href={CHAINS[w.chain as ChainId]?.explorerAddress(w.address)} target="_blank" rel="noopener noreferrer" className="text-sm text-fg-muted hover:text-fg">Explorer ↗</a>
          </>
        }
      />
      {(!provider || !provider.configured()) && <div className="mb-4"><Notice tone="warn">Set HELIUS_API_KEY to read this wallet&apos;s trades.</Notice></div>}

      <Card className="mb-4">
        <CardHeader title="In plain words" subtitle={lastActive ? `Last active ${timeAgo(lastActive)}` : "No recorded activity yet"} />
        <div className="grid gap-4 px-4 py-3 text-sm lg:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">How it trades</div>
            <p className="mt-1 text-fg-muted">{behaviour ? behaviour.text : "Not scored yet: the worker scores followed and discovered wallets within minutes."}</p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Its own results · last 30 days</div>
            {facts ? (
              <p className="mt-1 text-fg-muted">
                <span className={cx("num", facts.pnlSol >= 0 ? "text-pos" : "text-down")}>{formatSol(facts.pnlSol)}</span> profit, {facts.decided ? Math.round((facts.wins / facts.decided) * 100) : 0}% of {facts.decided} finished positions won.
                {facts.oos === "held_up" && <span className="text-pos"> Its last 10 days (not used for the score) confirm it.</span>}
              </p>
            ) : <p className="mt-1 text-fg-faint">Not available.</p>}
            {confidence && <p className={cx("mt-1 text-xs", confidence.level === "none" || confidence.level === "low" ? "text-warn" : "text-fg-faint")}>{confidence.text}</p>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">If you had copied it · 30 days</div>
            {copy?.trades && copyNet !== null ? (
              <p className="mt-1 text-fg-muted">
                <span className={cx("num", copyNet >= 0 ? "text-pos" : "text-down")}>{formatPct(copyNet, 1)}</span> per copied trade on average after ~{MODELED_COST_PCT}% modeled fees and slippage
                ({formatPct(copy.avg_return, 1)} before costs, median {formatPct(copy.median_return, 1)}), over {copy.trades} trades, {copy.wins} in profit.
              </p>
            ) : <p className="mt-1 text-fg-faint">No copied trades measured yet: SOLME needs to see this wallet&apos;s buys live.</p>}
            <p className="mt-1 text-xs text-fg-faint">Entered at the price when SOLME saw each buy, exited when the wallet sold. Past results; following a wallet does not reproduce them.</p>
          </div>
        </div>
        {risks.length > 0 && (
          <ul className="space-y-1 border-t border-line px-4 py-3 text-xs text-warn">
            {risks.map((r) => <li key={r} className="flex gap-1.5"><span aria-hidden="true">!</span>{r}</li>)}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Trades · 30d" value={facts ? facts.trades : "—"} sub={facts ? (facts.trades / coveredDays < 1 ? "less than one a day" : `about ${formatNumber(facts.trades / coveredDays, 0)} a day`) : undefined} />
        <Stat label="Typical hold" value={facts?.medianHoldMinutes != null ? (facts.medianHoldMinutes < 120 ? `${Math.round(facts.medianHoldMinutes)} min` : `${(facts.medianHoldMinutes / 60).toFixed(1)} h`) : "—"} sub="median of closed positions" />
        <Stat label="Early entries" value={facts ? facts.earlyEntries : "—"} sub="bought within 1h of launch" />
        <Stat label="Last active" value={lastActive ? timeAgo(lastActive) : "—"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
        {w.chain === "solana" && (
          <Suspense fallback={<Card><CardHeader title="Holds now" subtitle="Reading balances from the chain…" /></Card>}>
            <HoldingsCard address={w.address} />
          </Suspense>
        )}
        <Card>
          <CardHeader title="Coins it traded recently" subtitle="From recorded buys and sells" />
          {exposure.length === 0 ? <EmptyState title="No token activity recorded" /> : (
            <ul className="divide-y divide-line text-sm">
              {exposure.map((e) => {
                const net = (e.inflow ?? 0) - (e.outflow ?? 0);
                return (
                  <li key={e.token_address} className="flex items-center justify-between px-4 py-2">
                    <span className="font-medium">{e.token_symbol ?? shortAddress(e.token_address)}</span>
                    <span className="text-xs text-fg-faint">{net > 0 ? "bought more than sold" : "sold"} · {e.txs} tx · {timeAgo(e.last)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        </div>
        <Card>
          <CardHeader title="Recent transactions" />
          <WalletTxTable rows={txs} showWallet={false} />
        </Card>
      </div>

      <details className="card mt-4">
        <summary className="cursor-pointer px-4 py-3 text-sm text-fg-muted hover:text-fg">Technical details: score breakdown and every position</summary>
        <div className="border-t border-line p-4"><WalletScoreCard s={score} /></div>
      </details>
    </>
  );
}

/** What the wallet holds right now, read live from the chain and valued at SOLME's latest prices. */
async function HoldingsCard({ address }: { address: string }) {
  let h: Awaited<ReturnType<typeof liveHoldings>> = null;
  let error: string | null = null;
  try {
    h = await liveHoldings(address);
  } catch (err) {
    error = errorMessage(err);
  }
  if (!h) {
    return (
      <Card>
        <CardHeader title="Holds now" />
        <p className="px-4 py-3 text-xs text-fg-faint">{error ? `Live balances unavailable right now (${error.slice(0, 80)}).` : "Live balances need HELIUS_API_KEY."}</p>
      </Card>
    );
  }
  const total = h.priced.reduce((sum, x) => sum + (x.valueUsd ?? 0), 0) + (h.solUsd ? h.sol * h.solUsd : 0);
  return (
    <Card>
      <CardHeader title="Holds now" subtitle={`Live from the chain, read ${timeAgo(h.readAt)} · about ${formatUsd(total, { compact: true })} in priced coins and SOL`} />
      <ul className="divide-y divide-line text-sm">
        <li className="flex items-center justify-between px-4 py-2">
          <span className="font-medium">SOL</span>
          <span className="num text-xs text-fg-muted">{formatNumber(h.sol, 2)}{h.solUsd ? ` · ${formatUsd(h.sol * h.solUsd, { compact: true })}` : ""}</span>
        </li>
        {h.priced.slice(0, 15).map((x) => (
          <li key={x.mint} className="flex items-center justify-between px-4 py-2">
            {x.tokenId ? <Link href={`/app/token/solana/${x.tokenId}`} className="font-medium hover:text-up">{x.symbol ?? shortAddress(x.mint)}</Link> : <span className="font-medium">{x.symbol ?? shortAddress(x.mint)}</span>}
            <span className="num text-xs text-fg-muted">{formatCompact(x.amount)} · {formatUsd(x.valueUsd, { compact: true })}</span>
          </li>
        ))}
      </ul>
      {(h.priced.length > 15 || h.unpriced > 0) && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
          {h.priced.length > 15 ? `${h.priced.length - 15} smaller priced holdings not shown. ` : ""}
          {h.unpriced > 0 ? `${h.unpriced} other token${h.unpriced === 1 ? "" : "s"} with no market price SOLME tracks (often dust or airdrops).` : ""}
        </p>
      )}
    </Card>
  );
}
