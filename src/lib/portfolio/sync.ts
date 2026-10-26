import type { Queryable } from "@/lib/db";
import { badRequest } from "@/lib/http";
import { computePosition } from "./calc";

/** Re-derives open/closed status from the full trade history and rejects histories that oversell. */
export async function syncPositionStatus(tx: Queryable, positionId: string) {
  const trades = await tx.query<{ side: "buy" | "sell"; quantity: number; price: number; fee: number; executed_at: Date }>(
    "SELECT side, quantity, price, fee, executed_at FROM trades WHERE position_id = $1",
    [positionId],
  );
  const m = computePosition(trades.map((t) => ({ ...t, executedAt: new Date(t.executed_at) })), null);
  if (m.error) throw badRequest(`${m.error}. Sells cannot exceed the quantity held at that time.`);
  const last = trades.reduce((d, t) => (new Date(t.executed_at) > d ? new Date(t.executed_at) : d), new Date(0));
  await tx.query("UPDATE positions SET status = $2, closed_at = $3, updated_at = now() WHERE id = $1", [positionId, m.closed ? "closed" : "open", m.closed ? last : null]);
}
