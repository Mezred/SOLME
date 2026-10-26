/**
 * Portfolio math (pure). Method: weighted-average cost.
 *  - Buy:  cost basis += qty × price + fee; open qty += qty.
 *  - Sell: realized += qty × price − fee − avgCost × qty; cost basis −= avgCost × qty.
 *  - Unrealized = (current price − avgCost) × open qty; null when no current price is available.
 *  - Return % = (realized + unrealized) / total capital deployed (all buys incl. fees).
 * Manual positions are user-reported and are never presented as verified holdings.
 */
export interface TradeInput {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: Date;
}

export interface PositionMetrics {
  openQuantity: number;
  avgCost: number | null;
  costBasisOpen: number;
  totalInvested: number;
  realizedPnl: number;
  unrealizedPnl: number | null;
  totalFees: number;
  marketValue: number | null;
  returnPct: number | null;
  closed: boolean;
  /** Set when sells exceed holdings — such data is rejected at input, this guards stored history. */
  error: string | null;
  realizedEvents: { at: Date; pnl: number }[];
}

const EPS = 1e-12;

export function computePosition(trades: TradeInput[], currentPrice: number | null): PositionMetrics {
  const sorted = [...trades].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  let qty = 0;
  let cost = 0;
  let invested = 0;
  let realized = 0;
  let fees = 0;
  let error: string | null = null;
  const realizedEvents: { at: Date; pnl: number }[] = [];

  for (const t of sorted) {
    fees += t.fee;
    if (t.side === "buy") {
      cost += t.quantity * t.price + t.fee;
      invested += t.quantity * t.price + t.fee;
      qty += t.quantity;
    } else {
      if (t.quantity > qty + EPS) {
        error = `Sell of ${t.quantity} exceeds open quantity ${qty}`;
        break;
      }
      const avg = qty > 0 ? cost / qty : 0;
      const pnl = t.quantity * t.price - t.fee - avg * t.quantity;
      realized += pnl;
      realizedEvents.push({ at: t.executedAt, pnl });
      cost -= avg * t.quantity;
      qty -= t.quantity;
      if (qty < EPS) {
        qty = 0;
        cost = 0;
      }
    }
  }

  const avgCost = qty > 0 ? cost / qty : null;
  const unrealized = qty === 0 ? 0 : currentPrice === null || avgCost === null ? null : (currentPrice - avgCost) * qty;
  const marketValue = qty === 0 ? 0 : currentPrice === null ? null : currentPrice * qty;
  const returnPct = invested > 0 && unrealized !== null ? ((realized + unrealized) / invested) * 100 : null;

  return {
    openQuantity: qty,
    avgCost,
    costBasisOpen: cost,
    totalInvested: invested,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    totalFees: fees,
    marketValue,
    returnPct,
    closed: qty === 0 && sorted.length > 0 && !error,
    error,
    realizedEvents,
  };
}

export interface PortfolioSummary {
  totalInvested: number;
  realizedPnl: number;
  unrealizedPnl: number | null;
  /** Positions whose unrealized P&L could not be computed (missing price). */
  positionsMissingPrice: number;
  marketValue: number | null;
  returnPct: number | null;
  closedPositions: number;
  winRate: number | null;
  maxDrawdownUsd: number | null;
  maxDrawdownPct: number | null;
  equityCurve: { at: string; cumulativePnl: number }[];
}

/** Aggregates position metrics. Win rate / drawdown need ≥3 closed positions / realized events to be meaningful. */
export function summarizePortfolio(positions: PositionMetrics[], now = new Date()): PortfolioSummary {
  const invested = positions.reduce((s, p) => s + p.totalInvested, 0);
  const realized = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const missing = positions.filter((p) => p.unrealizedPnl === null).length;
  const unrealized = missing > 0 ? null : positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const knownUnrealized = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const marketValue = positions.some((p) => p.marketValue === null) ? null : positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);

  const closed = positions.filter((p) => p.closed);
  const winRate = closed.length >= 3 ? (closed.filter((p) => p.realizedPnl > 0).length / closed.length) * 100 : null;

  const events = positions.flatMap((p) => p.realizedEvents).sort((a, b) => a.at.getTime() - b.at.getTime());
  const curve: { at: string; cumulativePnl: number }[] = [];
  let cum = 0;
  for (const e of events) {
    cum += e.pnl;
    curve.push({ at: e.at.toISOString(), cumulativePnl: cum });
  }
  if (positions.some((p) => p.openQuantity > 0)) curve.push({ at: now.toISOString(), cumulativePnl: cum + knownUnrealized });

  let maxDd: number | null = null;
  if (events.length >= 3) {
    let peak = 0;
    maxDd = 0;
    for (const pt of curve) {
      peak = Math.max(peak, pt.cumulativePnl);
      maxDd = Math.max(maxDd, peak - pt.cumulativePnl);
    }
  }

  return {
    totalInvested: invested,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    positionsMissingPrice: missing,
    marketValue,
    returnPct: invested > 0 && unrealized !== null ? ((realized + unrealized) / invested) * 100 : null,
    closedPositions: closed.length,
    winRate,
    maxDrawdownUsd: maxDd,
    maxDrawdownPct: maxDd !== null && invested > 0 ? (maxDd / invested) * 100 : null,
    equityCurve: curve,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}
