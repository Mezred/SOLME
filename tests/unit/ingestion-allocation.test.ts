import { describe, expect, it } from "vitest";
import { allocateCandidates } from "@/lib/ingestion/pipeline";
import type { DiscoveryCandidate } from "@/lib/providers/types";

const c = (n: number, reason: DiscoveryCandidate["reason"] | "watchlist" = "trending") =>
  ({ chain: "solana", address: `mint-${n}`, reason, source: "test" }) as DiscoveryCandidate;

describe("allocateCandidates", () => {
  it("keeps the per-cycle budget, in priority order", () => {
    const out = allocateCandidates(Array.from({ length: 100 }, (_, i) => c(i)), ["solana"], 30);
    expect(out).toHaveLength(30);
    expect(out[0].address).toBe("mint-0");
    expect(out[29].address).toBe("mint-29");
  });

  it("keeps user-priority tokens (watchlists) first", () => {
    const out = allocateCandidates([...Array.from({ length: 10 }, (_, i) => c(i)), c(99, "watchlist")], ["solana"], 3);
    expect(out[0].address).toBe("mint-99");
    expect(out).toHaveLength(3);
  });

  it("returns everything when under budget, without duplicates", () => {
    const out = allocateCandidates([c(1), c(2)], ["solana"], 120);
    expect(out.map((x) => x.address)).toEqual(["mint-1", "mint-2"]);
  });
});
