import { Card, VerdictBadge } from "@/components/ui";
import { decide, sectionSummary, type DecisionInput, type GateStatus } from "@/lib/decision/verdict";
import { evidenceInput, loadDecisionEvidence } from "@/lib/decision/evidence";
import { formatNumber, timeAgo } from "@/lib/format";
import { GMGN_DISCLOSURE, gmgnTradeUrl } from "@/lib/gmgn";
import type { ChainId } from "@/lib/chains";

const STATUS: Record<GateStatus, { mark: string; cls: string }> = {
  pass: { mark: "✓", cls: "text-up" },
  warn: { mark: "!", cls: "text-warn" },
  fail: { mark: "✗", cls: "text-down" },
  unknown: { mark: "?", cls: "text-fg-faint" },
};
const TIMING_TEXT = { early: "Early — no vertical move yet", "mid-move": "Mid-move — already moving, size down", overextended: "Vertical move — don't chase, wait for a pullback", dumping: "Dumping — wait for it to stabilise", unknown: "Not enough price data" };
const scoreCls = (n: number) => (n >= 75 ? "text-up" : n >= 45 ? "text-warn" : "text-down");

/**
 * Coin Check on a token page: the verdict in one line, the five questions (can I sell, is the liquidity real, who
 * controls it, are insiders set to dump, is the trading genuine) with every finding, the reasons to buy, what would
 * change the verdict, and a memecoin plan. Async (holders and the investigation take a few seconds): wrap in <Suspense>.
 */
export async function DecisionCard({ t, input, userId }: { t: { chain: ChainId; address: string; is_demo: boolean }; input: DecisionInput; userId?: string }) {
  const ev = await loadDecisionEvidence(t, userId);
  const d = decide({ ...input, ...evidenceInput(ev) });
  const gmgn = t.is_demo ? null : gmgnTradeUrl(t.chain, t.address);
  const border = d.verdict === "tradeable" || d.verdict === "candidate" ? "border-up" : d.verdict === "avoid" ? "border-down/60" : "border-warn/50";
  const exit = d.gate.find((g) => g.key === "exit");

  return (
    <Card className={`border-l-4 ${border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Coin check</span>
            <VerdictBadge verdict={d.verdict} size="lg" />
            <span className="rounded-md border border-line px-2 py-0.5 text-xs" title="Across the five questions; capped low when any check failed">
              Safety <b className={`num ${scoreCls(d.safetyScore)}`}>{d.safetyScore}</b><span className="text-fg-faint">/100</span>
            </span>
          </div>
          <p className="mt-1.5 text-sm text-fg">{d.headline}.</p>
          <p className={`mt-0.5 text-xs ${d.timing === "overextended" || d.timing === "dumping" ? "text-down" : d.timing === "mid-move" ? "text-warn" : "text-fg-muted"}`}>Timing: {TIMING_TEXT[d.timing]}</p>
        </div>
        {gmgn && d.verdict !== "avoid" && (
          <a href={gmgn} target="_blank" rel="noopener noreferrer sponsored" title={GMGN_DISCLOSURE} className="shrink-0 rounded-md border border-up bg-up px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-950 hover:bg-ink-950 hover:text-up">
            Trade on GMGN ↗
          </a>
        )}
      </div>

      <div className="grid gap-px bg-line lg:grid-cols-[1.5fr_1fr]">
        {/* The five questions */}
        <div className="divide-y divide-line bg-ink-900">
          {d.sections.map((s) => (
            <details key={s.key} className="group px-4 py-2.5" open={s.status === "fail" || s.status === "warn"}>
              <summary className="flex cursor-pointer list-none items-start gap-2.5 text-sm">
                <span className={`num mt-0.5 w-3 shrink-0 font-bold ${STATUS[s.status].cls}`} aria-label={s.status}>{STATUS[s.status].mark}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-fg">{s.question}</span>
                  <span className="block text-xs text-fg-muted">{sectionSummary(s)}</span>
                </span>
                <span className={`num shrink-0 text-xs ${scoreCls(s.score)}`}>{s.score}</span>
                <span className="shrink-0 text-xs text-fg-faint transition-transform group-open:rotate-90" aria-hidden="true">›</span>
              </summary>
              <ul className="mt-2 space-y-1 pl-5 text-xs">
                {s.items.map((g) => (
                  <li key={g.key} className="flex gap-2">
                    <span className={`num w-3 shrink-0 font-bold ${STATUS[g.status].cls}`} aria-label={g.status}>{STATUS[g.status].mark}</span>
                    <span><span className="text-fg">{g.label}</span> <span className="text-fg-faint">— {g.detail}</span></span>
                  </li>
                ))}
                {!s.items.length && <li className="text-fg-faint">Not checked for this coin.</li>}
                {s.key === "insiders" && ev.holderError && <li className="text-fg-faint">Holder check unavailable: {ev.holderError.slice(0, 80)}</li>}
              </ul>
            </details>
          ))}
        </div>

        {/* Reasons, what would change it, plan */}
        <div className="space-y-4 bg-ink-900 px-4 py-3 text-xs">
          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Reasons to buy</h3>
            {d.edges.length ? (
              <ul className="space-y-1 text-up">{d.edges.map((e) => <li key={e}>+ {e}</li>)}</ul>
            ) : (
              <p className="text-fg-muted">None yet: no smart-wallet buys, no proven dev, no strong genuine buy flow.</p>
            )}
            <ul className="mt-2 space-y-0.5 text-fg-muted">
              <li>
                Smart wallets (24h):{" "}
                {ev.smartBuys.wallets > 0
                  ? <span className="text-fg">{ev.smartBuys.wallets} bought · {formatNumber(ev.smartBuys.sol, 1)} SOL · last {timeAgo(ev.smartBuys.last)}</span>
                  : <span className="text-fg-faint">none detected</span>}
              </li>
              {ev.dev && <li>Dev: {ev.dev.launches} launches, {ev.dev.migrated} migrated{ev.dev.score !== null && <> · score <span className={ev.dev.score >= 60 ? "text-up" : "text-fg"}>{ev.dev.score}</span></>}</li>}
            </ul>
          </section>

          {d.verdict === "avoid" ? (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Verdict</h3>
              <p className="text-fg-muted">A failed safety check rarely recovers. Skip it, there is always another coin.</p>
            </section>
          ) : d.next.length > 0 ? (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">What would make it buy-ready</h3>
              <ul className="space-y-1 text-fg-muted">{d.next.map((n) => <li key={n}>• {n}</li>)}</ul>
            </section>
          ) : null}

          {d.verdict !== "avoid" && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">If you buy</h3>
              <ul className="space-y-1 text-fg-muted">
                <li>• Size: only what you can afford to lose entirely.</li>
                {exit && <li>• Exit cost: {exit.detail.charAt(0).toLowerCase() + exit.detail.slice(1)}.</li>}
                <li>• Take your initial out at 2×; let the rest ride.</li>
                <li>• Get out if the dev sells, the smart wallets sell, or liquidity drops. SOLME alerts you on the first two.</li>
              </ul>
            </section>
          )}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
        Research from on-chain data and a simulated sell, not advice. A coin can still fail after passing every check.
      </p>
    </Card>
  );
}
