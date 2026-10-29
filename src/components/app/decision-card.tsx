import { Card, cx, VerdictBadge } from "@/components/ui";
import { decide, RISK_TEXT, sectionSummary, type Basis, type DecisionInput, type GateStatus, type RiskLevel } from "@/lib/decision/verdict";
import { evidenceInput, evidenceRefs, loadDecisionEvidence } from "@/lib/decision/evidence";
import { evidenceLinks } from "@/lib/decision/links";
import { formatNumber, timeAgo } from "@/lib/format";
import { GMGN_DISCLOSURE, gmgnTradeUrl } from "@/lib/gmgn";
import type { ChainId } from "@/lib/chains";

const STATUS: Record<GateStatus, { mark: string; cls: string; word: string }> = {
  pass: { mark: "✓", cls: "text-pos", word: "OK" },
  warn: { mark: "!", cls: "text-warn", word: "Caution" },
  fail: { mark: "✗", cls: "text-down", word: "Problem" },
  unknown: { mark: "?", cls: "text-fg-faint", word: "Not measured" },
};
const RISK_CLS: Record<RiskLevel, string> = {
  low: "border-pos/50 bg-pos/10 text-pos",
  moderate: "border-warn/50 bg-warn/10 text-warn",
  high: "border-down/50 bg-down/10 text-down",
  critical: "border-down bg-down text-white",
};
const RISK_ICON: Record<RiskLevel, string> = { low: "●", moderate: "!", high: "▲", critical: "✗" };
const BASIS: Record<Basis, { text: string; title: string }> = {
  confirmed: { text: "confirmed", title: "Read directly from the blockchain or a simulated transaction" },
  inferred: { text: "inferred", title: "Deduced from on-chain patterns: likely, not proven" },
  unavailable: { text: "not available", title: "Could not be measured for this coin right now" },
};
const TIMING_TEXT = { early: "Early: no vertical move yet", "mid-move": "Mid-move: already moving, size down", overextended: "Vertical move: don't chase, wait for a pullback", dumping: "Dumping: wait for it to stabilise", unknown: "Not enough price data" };

/**
 * Coin Check on a token page, plain language first: overall risk and the three findings that matter most, then the
 * five questions (expand any for every finding, with how SOLME knows it and when it was read), reasons to buy, what is
 * missing, and an exit plan. Async (holders and the investigation take a few seconds): wrap in <Suspense>.
 */
export async function DecisionCard({ t, input, userId }: { t: { chain: ChainId; address: string; is_demo: boolean }; input: DecisionInput; userId?: string }) {
  const ev = await loadDecisionEvidence(t, userId);
  const d = decide({ ...input, ...evidenceInput(ev) });
  const links = t.chain === "solana" && !t.is_demo ? evidenceLinks(evidenceRefs(t.address, ev)) : {};
  const gmgn = t.is_demo ? null : gmgnTradeUrl(t.chain, t.address);
  const border = d.risk === "low" ? "border-pos" : d.risk === "moderate" ? "border-warn/60" : "border-down/70";
  const exit = d.gate.find((g) => g.key === "exit");
  const read = [
    ev.holders ? `holders ${timeAgo(ev.holders.computedAt)}` : null,
    ev.investigation ? `sell test, wallets & trades ${timeAgo(ev.investigation.computedAt)}` : null,
  ].filter(Boolean);

  return (
    <Card className={`border-l-4 ${border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Coin Check</span>
            <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-bold uppercase tracking-wide", RISK_CLS[d.risk])}>
              <span aria-hidden="true">{RISK_ICON[d.risk]}</span>
              {RISK_TEXT[d.risk].label} risk
            </span>
          </div>
          <p className="mt-2 text-sm text-fg">{RISK_TEXT[d.risk].line}</p>
          <ol className="mt-2 space-y-1 text-sm">
            {d.findings.map((g) => (
              <li key={g.key} className="flex gap-2">
                <span className={cx("num w-3 shrink-0 font-bold", STATUS[g.status].cls)} aria-label={STATUS[g.status].word}>{STATUS[g.status].mark}</span>
                <span><span className="text-fg">{g.label}:</span> <span className="text-fg-muted">{g.detail}</span></span>
              </li>
            ))}
          </ol>
        </div>
        {gmgn && d.risk !== "critical" && (
          <a href={gmgn} target="_blank" rel="noopener noreferrer sponsored" title={GMGN_DISCLOSURE} className="shrink-0 rounded-md border border-up px-3 py-2 text-xs font-bold uppercase tracking-wide text-up hover:bg-up hover:text-ink-950">
            Trade on GMGN ↗
          </a>
        )}
      </div>

      <div className="grid gap-px bg-line lg:grid-cols-[1.5fr_1fr]">
        {/* The five questions */}
        <div className="divide-y divide-line bg-ink-900">
          {d.sections.map((s) => (
            <details key={s.key} className="group px-4 py-2.5" open={s.status === "fail"}>
              <summary className="flex cursor-pointer list-none items-start gap-2.5 text-sm">
                <span className={`num mt-0.5 w-3 shrink-0 font-bold ${STATUS[s.status].cls}`} aria-label={STATUS[s.status].word}>{STATUS[s.status].mark}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-fg">{s.question}</span>
                  <span className="block text-xs text-fg-muted">{sectionSummary(s)}</span>
                </span>
                <span className="shrink-0 text-xs text-fg-faint group-open:hidden">Details</span>
                <span className="shrink-0 text-xs text-fg-faint transition-transform group-open:rotate-90" aria-hidden="true">›</span>
              </summary>
              <ul className="mt-2 space-y-1.5 pl-5 text-xs">
                {s.items.map((g) => (
                  <li key={g.key} className="flex gap-2">
                    <span className={`num w-3 shrink-0 font-bold ${STATUS[g.status].cls}`} aria-label={STATUS[g.status].word}>{STATUS[g.status].mark}</span>
                    <span className="flex-1">
                      <span className="text-fg">{g.label}</span> <span className="text-fg-faint">— {g.detail}</span>
                      {g.basis && <span title={BASIS[g.basis].title} className={cx("ml-1.5 rounded border px-1 text-[10px]", g.basis === "inferred" ? "border-warn/40 text-warn" : g.basis === "unavailable" ? "border-line text-fg-faint" : "border-line-strong text-fg-muted")}>{BASIS[g.basis].text}</span>}
                      {g.status !== "unknown" && links[g.key]?.length ? (
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          {links[g.key]!.map((l) => (
                            <a key={l.href} href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="text-[11px] text-up hover:underline">
                              {l.label}{l.external && <span aria-hidden="true"> ↗</span>}{l.external && <span className="sr-only"> (opens in a new tab)</span>}
                            </a>
                          ))}
                        </span>
                      ) : g.key === "sell" && g.status !== "unknown" ? (
                        <span className="mt-0.5 block text-[11px] text-fg-faint">Simulated on-chain, never sent: there is no transaction to view.</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {!s.items.length && <li className="text-fg-faint">Not checked for this coin.</li>}
                {s.key === "insiders" && ev.holderError && <li className="text-fg-faint">Holder check unavailable: {ev.holderError.slice(0, 80)}</li>}
              </ul>
            </details>
          ))}
        </div>

        {/* SOLME's read, reasons, what is missing, plan */}
        <div className="space-y-4 bg-ink-900 px-4 py-3 text-xs">
          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">SOLME&apos;s read</h3>
            <div className="flex flex-wrap items-center gap-2"><VerdictBadge verdict={d.verdict} /><span className="text-fg-muted">{TIMING_TEXT[d.timing]}</span></div>
            <p className="mt-1 text-fg-muted">{d.headline.replace(/^\w+ — /, "")}.</p>
          </section>

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Reasons to buy</h3>
            {d.edges.length ? (
              <ul className="space-y-1 text-pos">{d.edges.map((e) => <li key={e}>+ {e}</li>)}</ul>
            ) : (
              <p className="text-fg-muted">None found: no smart-wallet buys, no proven dev, no strong genuine buy flow.</p>
            )}
            <ul className="mt-2 space-y-0.5 text-fg-muted">
              <li>
                Smart wallets (24h):{" "}
                {ev.smartBuys.wallets > 0
                  ? <span className="text-fg">{ev.smartBuys.wallets} bought · {formatNumber(ev.smartBuys.sol, 1)} SOL · last {timeAgo(ev.smartBuys.last)}</span>
                  : <span className="text-fg-faint">none detected</span>}
              </li>
              {ev.dev && <li>Dev: {ev.dev.launches} launches, {ev.dev.migrated} migrated{ev.dev.score !== null && <> · score {ev.dev.score}</>}</li>}
            </ul>
          </section>

          {d.next.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">What is missing</h3>
              <ul className="space-y-1 text-fg-muted">{d.next.map((n) => <li key={n}>• {n}</li>)}</ul>
            </section>
          )}

          {d.risk !== "critical" && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">If you buy</h3>
              <ul className="space-y-1 text-fg-muted">
                <li>• Size: only what you can afford to lose entirely.</li>
                {exit && <li>• Exit cost: {exit.detail.charAt(0).toLowerCase() + exit.detail.slice(1)}.</li>}
                <li>• Take your initial out at 2×; let the rest ride.</li>
                <li>• Get out if the dev sells, the smart wallets sell, or liquidity drops. SOLME alerts you on these.</li>
              </ul>
            </section>
          )}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-fg-faint">
        {read.length ? `Read ${read.join(" · ")}. ` : ""}<b className="font-normal text-fg-muted">Confirmed</b> = read on-chain or simulated; <b className="font-normal text-warn">inferred</b> = deduced from patterns, likely but not proven. Links open the evidence on Solscan. Research, not advice.
      </p>
    </Card>
  );
}
