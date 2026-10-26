import { Badge, ScoreBar } from "@/components/ui";
import { FACTOR_DOCS } from "@/lib/scoring/engine";

export interface FactorView {
  key: string;
  category: string;
  score: number | null;
  weight: number;
  reason: string;
  missing: boolean;
  evidence: Record<string, unknown>;
}

const CAT_TONE = { quality: "info", momentum: "up", risk: "down", context: "ai" } as const;

export function FactorList({ factors }: { factors: FactorView[] }) {
  const total = factors.reduce((s, f) => s + (f.missing ? 0 : f.weight), 0) || 1;
  return (
    <ul className="divide-y divide-line">
      {[...factors].sort((a, b) => Number(a.missing) - Number(b.missing) || b.weight - a.weight).map((f) => {
        const doc = FACTOR_DOCS[f.key];
        const effWeight = f.missing ? 0 : (f.weight / total) * 100;
        return (
          <li key={f.key} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {doc?.label ?? f.key}
                <Badge tone={CAT_TONE[f.category as keyof typeof CAT_TONE] ?? "neutral"}>{f.category}</Badge>
              </span>
              <span className="num text-xs text-fg-muted">
                {f.missing ? <span className="text-warn">unavailable</span> : <>{f.score}<span className="text-fg-faint"> · w {effWeight.toFixed(0)}%</span></>}
              </span>
            </div>
            <div className="mt-1.5">{f.missing ? <div className="h-1.5 rounded-full border border-dashed border-line-strong" /> : <ScoreBar score={f.score} />}</div>
            <p className="mt-1 text-xs text-fg-faint" title={doc?.description}>
              {f.reason}
              {f.missing && " — excluded from the score (not counted as zero)."}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
