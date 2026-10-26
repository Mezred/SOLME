import { Badge, CardHeader, Notice, RiskBadge } from "@/components/ui";
import type { SecurityRow } from "@/lib/data/tokens";
import { formatDateTime, timeAgo } from "@/lib/format";

const RESULT_TONE = { pass: "up", warn: "warn", fail: "down", unavailable: "neutral" } as const;

export function SecurityPanel({ sec }: { sec: SecurityRow | null }) {
  if (!sec) {
    return (
      <>
        <CardHeader title="Token security" action={<RiskBadge level="unknown" />} />
        <div className="p-4">
          <Notice tone="warn" title="Not checked yet">
            No security report exists for this token. This is <strong>not</strong> a clean result — treat the token as unverified.
          </Notice>
        </div>
      </>
    );
  }
  const order = { fail: 0, warn: 1, pass: 2, unavailable: 3 } as const;
  const checks = [...sec.checks].sort((a, b) => order[a.result] - order[b.result]);
  return (
    <>
      <CardHeader
        title="Token security"
        subtitle={<span title={formatDateTime(sec.checked_at)}>Provider: {sec.provider} · checked {timeAgo(sec.checked_at)} · {sec.status}</span>}
        action={<RiskBadge level={sec.risk_level} />}
      />
      {sec.status === "unavailable" ? (
        <div className="p-4">
          <Notice tone="warn" title="Provider returned no data">
            {sec.limitations} This token is unverified — not clean.
          </Notice>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
              <span className={c.result === "unavailable" ? "text-fg-faint" : ""}>{c.label}</span>
              <span className="flex items-center gap-2 text-right text-xs text-fg-faint">
                <span className="max-w-[220px]">{c.detail}</span>
                <Badge tone={RESULT_TONE[c.result]}>{c.result === "unavailable" ? "n/a" : c.result}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1 border-t border-line px-4 py-3 text-xs text-fg-faint">
        {sec.holder_count !== null && <p>Holders: <span className="num text-fg-muted">{sec.holder_count.toLocaleString("en-US")}</span>{sec.top10_holder_pct !== null && <> · Top 10 (ex-pools): <span className="num text-fg-muted">{sec.top10_holder_pct.toFixed(1)}%</span></>}</p>}
        <p>{sec.limitations}</p>
        {sec.unavailable_checks.length > 0 && <p>Unavailable checks: {sec.unavailable_checks.join(", ")}.</p>}
        {sec.is_demo && <p className="text-warn">DEMO DATA — synthetic report.</p>}
      </div>
    </>
  );
}
