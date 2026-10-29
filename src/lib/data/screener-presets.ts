/**
 * One-tap scans for Solana memecoin traders: the setups worth checking several times a day, as Screener query
 * parameters (same keys as saved templates). Client-safe.
 */
export interface ScreenerPreset {
  key: string;
  label: string;
  hint: string;
  params: Record<string, string>;
}

export const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    key: "fresh",
    label: "🆕 Fresh launches",
    hint: "Under 1 hour old and already trading: 150+ txns and $10K+ volume in the last hour",
    params: { maxAgeHours: "1", minTxnsH1: "150", minVolumeH1: "10000", sort: "age", dir: "desc" },
  },
  {
    key: "graduated",
    label: "🎓 Just graduated",
    hint: "pump.fun / LetsBonk coins that migrated to PumpSwap or Raydium in the last 6h, $15K+ liquidity",
    params: { dex: "pumpswap,raydium", launchpad: "pump,bonk", maxAgeHours: "6", minLiquidity: "15000", sort: "volume_h1", dir: "desc" },
  },
  {
    key: "pumping",
    label: "🔥 Pumping now",
    hint: "+10% in 5 minutes on real flow: $5K+ 5m volume, 40+ 5m txns, $10K+ liquidity",
    params: { minChangeM5: "10", minVolumeM5: "5000", minTxnsM5: "40", minLiquidity: "10000", sort: "change_m5", dir: "desc" },
  },
  {
    key: "runners",
    label: "📈 Steady runners",
    hint: "Up 5%+ on 1h and 20%+ on 6h, buyers 55%+ of the flow, under $5M market cap",
    params: { minChangeH1: "5", minChangeH6: "20", minBuyShare: "55", minLiquidity: "25000", maxMcap: "5000000", sort: "change_h6", dir: "desc" },
  },
  {
    key: "lowcap",
    label: "💎 Low cap, real volume",
    hint: "Under $300K market cap with $100K+ daily volume and 1,000+ txns",
    params: { maxMcap: "300000", minVolume: "100000", minLiquidity: "15000", minTxnsH24: "1000", sort: "volume", dir: "desc" },
  },
  {
    key: "safe",
    label: "🛡️ Passed scam check",
    hint: "Contract OK, launch check passed, market cap at most 15× liquidity, has socials",
    params: { scamCheck: "passed", minLiquidity: "20000", maxMcapLiq: "15", profile: "1", sort: "volume_h1", dir: "desc" },
  },
];
