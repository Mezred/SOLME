import { withUser } from "@/lib/db";
import { computePosition, summarizePortfolio, type PositionMetrics, type TradeInput } from "@/lib/portfolio/calc";

export interface PositionView {
  id: string;
  portfolio_id: string;
  token_id: string | null;
  chain: string;
  token_address: string;
  token_symbol: string;
  source: string;
  status: string;
  stop_loss: number | null;
  take_profits: { price: number; pct?: number }[];
  notes: string | null;
  opened_at: Date;
  closed_at: Date | null;
  current_price: number | null;
  price_at: Date | null;
  logo_url: string | null;
  is_demo: boolean | null;
  trades: (TradeInput & { id: string; note: string | null })[];
  metrics: PositionMetrics;
}

export async function loadPortfolio(userId: string, portfolioId?: string) {
  return withUser(userId, async (tx) => {
    const portfolios = await tx.query<{ id: string; name: string }>("SELECT id, name FROM portfolios ORDER BY created_at");
    const current = portfolios.find((p) => p.id === portfolioId) ?? portfolios[0];
    if (!current) return { portfolios, current: null, positions: [] as PositionView[], summary: summarizePortfolio([]) };
    const positions = await tx.query<Omit<PositionView, "trades" | "metrics">>(
      `SELECT p.id, p.portfolio_id, p.token_id, p.chain, p.token_address, p.token_symbol, p.source, p.status, p.stop_loss, p.take_profits,
              p.notes, p.opened_at, p.closed_at, t.logo_url, t.is_demo, snap.price_usd AS current_price, snap.captured_at AS price_at
         FROM positions p LEFT JOIN token_assets t ON t.id = p.token_id
         LEFT JOIN LATERAL (SELECT price_usd, captured_at FROM market_snapshots ms WHERE ms.token_id = p.token_id ORDER BY captured_at DESC LIMIT 1) snap ON true
        WHERE p.portfolio_id = $1 ORDER BY p.status, p.opened_at DESC`,
      [current.id],
    );
    const trades = await tx.query<{ id: string; position_id: string; side: "buy" | "sell"; quantity: number; price: number; fee: number; executed_at: Date; note: string | null }>(
      `SELECT tr.id, tr.position_id, tr.side, tr.quantity, tr.price, tr.fee, tr.executed_at, tr.note FROM trades tr
         JOIN positions p ON p.id = tr.position_id WHERE p.portfolio_id = $1 ORDER BY tr.executed_at`,
      [current.id],
    );
    // Prices older than 6h are treated as unavailable rather than silently used.
    const views: PositionView[] = positions.map((p) => {
      const ts = trades.filter((t) => t.position_id === p.id).map((t) => ({ id: t.id, side: t.side, quantity: t.quantity, price: t.price, fee: t.fee, executedAt: new Date(t.executed_at), note: t.note }));
      const fresh = p.price_at && Date.now() - new Date(p.price_at).getTime() < 6 * 3_600_000 ? p.current_price : null;
      return { ...p, trades: ts, metrics: computePosition(ts, fresh) };
    });
    return { portfolios, current, positions: views, summary: summarizePortfolio(views.map((v) => v.metrics)) };
  });
}
