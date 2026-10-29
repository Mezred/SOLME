import { Badge } from "@/components/ui";
import type { LaunchRow } from "@/lib/data/launchpad";
import { formatAge } from "@/lib/format";

/** Background scam check (contract, exit, holders, dev wallet, bundle). Hover shows the main reason. */
export function LaunchCheckBadge({ t }: { t: Pick<LaunchRow, "check_passed" | "check_reason" | "checked_at"> }) {
  const when = t.checked_at ? ` · checked ${formatAge(t.checked_at)} ago` : "";
  if (t.check_passed === true) return <Badge tone="up" title={`${t.check_reason ?? "No safety check failed"}${when}`}>✓ scam check</Badge>;
  if (t.check_passed === false) return <Badge tone="down" title={`${t.check_reason ?? "A safety check failed"}${when}`}>✗ {t.check_reason?.split(/[—:.]/)[0]?.slice(0, 28) ?? "failed"}</Badge>;
  if (t.checked_at) return <Badge title={`${t.check_reason ?? "Could not be checked"}${when}`}>no market yet</Badge>;
  return <Badge title="Checked in the background within a few minutes">checking…</Badge>;
}
