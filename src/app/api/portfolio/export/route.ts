import { assertFeature, getEntitlements } from "@/lib/billing/entitlements";
import { withUser } from "@/lib/db";
import { api, requireUser } from "@/lib/http";
import { toCsv } from "@/lib/portfolio/calc";

/** CSV export of all manually recorded trades (Pro+). */
export const GET = api(async () => {
  const user = await requireUser();
  assertFeature(await getEntitlements(user.id), "csv_export", "CSV export");
  const rows = await withUser(user.id, (tx) =>
    tx.query<Record<string, unknown>>(
      `SELECT pf.name AS portfolio, p.chain, p.token_symbol, p.token_address, p.source, p.status, t.side, t.quantity, t.price, t.fee, t.executed_at, t.note, p.stop_loss
         FROM trades t JOIN positions p ON p.id = t.position_id JOIN portfolios pf ON pf.id = p.portfolio_id ORDER BY t.executed_at`,
    ),
  );
  const headers = ["portfolio", "chain", "token_symbol", "token_address", "source", "status", "side", "quantity", "price", "fee", "executed_at", "note", "stop_loss"];
  const csv = toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nexalpha-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
