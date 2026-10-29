import { describe, expect, it } from "vitest";
import { worthStoring } from "@/lib/ingestion/spam";
import type { MarketPairData } from "@/lib/providers/types";

const pair = (liquidityUsd: number | null, marketCap: number | null, volumeH24: number | null) =>
  ({ liquidityUsd, marketCap, fdv: marketCap, volume: { m5: null, h1: null, h6: null, h24: volumeH24 } }) as unknown as MarketPairData;

describe("worthStoring", () => {
  it("requires $1k liquidity when liquidity is reported", () => {
    expect(worthStoring(pair(5_000, 50_000, 0))).toBe(true);
    expect(worthStoring(pair(500, 5_000_000, 1_000_000))).toBe(false);
  });

  it("accepts bonding-curve pairs (no liquidity reported) only with real activity", () => {
    expect(worthStoring(pair(null, 40_000, 25_000))).toBe(true);
    expect(worthStoring(pair(null, 3_000, 25_000))).toBe(false);
    expect(worthStoring(pair(null, 40_000, 200))).toBe(false);
  });
});
