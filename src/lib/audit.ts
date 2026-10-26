import { query } from "@/lib/db";

/** Records a sensitive action. Awaited: callers should not proceed silently if auditing fails. */
export async function audit(
  actorUserId: string | null,
  action: string,
  target: { type?: string; id?: string } = {},
  metadata: Record<string, unknown> = {},
  ip?: string | null,
) {
  await query(
    "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip) VALUES ($1, $2, $3, $4, $5, $6)",
    [actorUserId, action, target.type ?? null, target.id ?? null, JSON.stringify(metadata), ip ?? null],
  );
}
