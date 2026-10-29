/** Display names and links per launchpad (`launchpad_tokens.pool`). Safe for client components. */
export function launchpadName(pool: string): string {
  return pool === "bonk" ? "LetsBonk" : "pump.fun";
}

/** The launchpad's own page for a token, or null when it has none we can link to. */
export function launchpadUrl(pool: string, mint: string): string | null {
  if (pool === "pump") return `https://pump.fun/coin/${mint}`;
  return null;
}
