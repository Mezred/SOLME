import { CHAINS, CHAIN_IDS } from "@/lib/chains";
import type { FilterField } from "./filter-bar";

const chainField: FilterField = { name: "chain", label: "Chain", type: "multi", options: CHAIN_IDS.map((c) => ({ value: c, label: CHAINS[c].short })) };

export const SIGNAL_FILTER_FIELDS: FilterField[] = [
  { name: "q", label: "Search", type: "text", placeholder: "Symbol, name, address", width: "w-full sm:w-52" },
  chainField,
  {
    name: "type",
    label: "Signal type",
    type: "multi",
    options: [
      { value: "momentum", label: "Momentum" },
      { value: "accumulation", label: "Accumulation" },
      { value: "breakout_watch", label: "Breakout" },
      { value: "distribution", label: "Distribution" },
      { value: "high_risk", label: "High risk" },
    ],
  },
  { name: "minScore", label: "Min score", type: "number", placeholder: "0–100", width: "w-24" },
  { name: "minConfidence", label: "Min confidence", type: "number", placeholder: "0–100", advanced: true, width: "w-28" },
  { name: "minLiquidity", label: "Min liquidity $", type: "number", placeholder: "50000", advanced: true },
  { name: "minVolume", label: "Min 24h vol $", type: "number", placeholder: "100000", advanced: true },
  { name: "minMcap", label: "Min mcap $", type: "number", advanced: true },
  { name: "maxMcap", label: "Max mcap $", type: "number", advanced: true },
  { name: "maxAgeHours", label: "Max age (h)", type: "number", placeholder: "72", advanced: true, width: "w-28" },
  { name: "minChangeH1", label: "Min 1h %", type: "number", advanced: true, width: "w-24" },
  { name: "minChangeH24", label: "Min 24h %", type: "number", advanced: true, width: "w-24" },
];

export const SCREENER_FILTER_FIELDS: FilterField[] = [
  { name: "q", label: "Search", type: "text", placeholder: "Symbol, name, address", width: "w-full sm:w-52" },
  chainField,
  { name: "minLiquidity", label: "Min liquidity $", type: "number", placeholder: "25000" },
  { name: "minVolume", label: "Min 24h vol $", type: "number", placeholder: "10000" },
  { name: "maxAgeHours", label: "Max age (h)", type: "number", width: "w-28" },
  { name: "minScore", label: "Min score", type: "number", advanced: true, width: "w-24" },
  { name: "minMcap", label: "Min mcap $", type: "number", advanced: true },
  { name: "maxMcap", label: "Max mcap $", type: "number", advanced: true },
  { name: "minAgeHours", label: "Min age (h)", type: "number", advanced: true, width: "w-28" },
  { name: "minChangeH1", label: "Min 1h %", type: "number", advanced: true, width: "w-24" },
  { name: "maxChangeH1", label: "Max 1h %", type: "number", advanced: true, width: "w-24" },
  { name: "minChangeH24", label: "Min 24h %", type: "number", advanced: true, width: "w-24" },
  { name: "maxChangeH24", label: "Max 24h %", type: "number", advanced: true, width: "w-24" },
  { name: "minBuyShare", label: "Min buy share %", type: "number", advanced: true, width: "w-28" },
  {
    name: "risk",
    label: "Security",
    type: "multi",
    advanced: true,
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
      { value: "unknown", label: "Unverified" },
    ],
  },
];
