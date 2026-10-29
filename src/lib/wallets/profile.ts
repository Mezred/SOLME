/**
 * Plain-language reading of a wallet's score (pure). Keeps the wallet's own results apart from what copying it would
 * have returned: copies enter later and pay fees and slippage, so they are modeled separately and are not achievable
 * returns either.
 */

/** Fees, priority tips and slippage for one copied round trip (buy + sell), %: a deliberately rough model. */
export const MODELED_COST_PCT = 3;

export interface WalletFacts {
  trades: number;
  decided: number;
  wins: number;
  pnlSol: number;
  earlyEntries: number;
  medianHoldMinutes: number | null;
  botLike: boolean;
  coveredDays: number;
  oos: "held_up" | "faded" | "too_few" | null;
  insiderReason: string | null;
}

export function walletBehaviour(f: WalletFacts): { label: string; text: string } {
  const perDay = f.trades / Math.max(1, f.coveredDays);
  const hold = f.medianHoldMinutes;
  if (f.botLike) return { label: "Bot-like", text: "Trades too fast or too often for a person to follow; its results can't be copied by hand." };
  if (f.decided > 0 && f.earlyEntries / f.decided >= 0.5 && hold !== null && hold < 60) return { label: "Early flipper", text: "Buys coins within their first hour and usually sells within the hour." };
  if (hold !== null && hold < 30) return { label: "Scalper", text: "In and out within minutes; hard to copy without losing the edge to delay." };
  if (hold !== null && hold < 24 * 60) return { label: "Day trader", text: `Usually holds for hours (median ${hold < 120 ? `${Math.round(hold)} min` : `${(hold / 60).toFixed(1)} h`}), about ${perDay < 1 ? "less than one trade" : `${Math.round(perDay)} trades`} a day.` };
  if (hold !== null) return { label: "Swing holder", text: `Holds for days (median ${(hold / 1440).toFixed(1)} days).` };
  return { label: "Not enough closed trades", text: "Too few closed positions to describe how it trades." };
}

/** How much the 30-day record can be trusted, from the number of finished positions. */
export function performanceConfidence(decided: number): { level: "none" | "low" | "medium" | "high"; text: string } {
  if (decided < 5) return { level: "none", text: `Only ${decided} finished positions: not enough to judge.` };
  if (decided < 15) return { level: "low", text: `${decided} finished positions: a small sample, luck can dominate.` };
  if (decided < 40) return { level: "medium", text: `${decided} finished positions: a fair sample for 30 days.` };
  return { level: "high", text: `${decided} finished positions: a solid sample for 30 days.` };
}

/** Average copied return after modeled costs, %; null without copied trades. */
export function copyAfterCosts(avgReturnPct: number | null, trades: number | null): number | null {
  if (avgReturnPct === null || !trades) return null;
  return avgReturnPct - MODELED_COST_PCT;
}

/** Things to be careful about with this wallet. */
export function walletRisks(f: WalletFacts): string[] {
  return [
    ...(f.insiderReason ? [`Possible launch insider: ${f.insiderReason} (inferred from funding links)`] : []),
    ...(f.botLike ? ["Bot-like trading: results are not reproducible by hand"] : []),
    ...(f.oos === "faded" ? ["Its last 10 days lost money: the record may be fading"] : []),
    ...(f.decided > 0 && f.wins / f.decided < 0.35 ? ["Wins under 35% of positions: a few big wins carry the record"] : []),
  ];
}
