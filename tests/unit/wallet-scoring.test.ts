import { describe, expect, it } from "vitest";
import type { RawTx } from "@/lib/providers/helius-history";
import { buildPositions, evaluatePositions, extractSwap, extractTrades, scoreWallet, type Swap, type TokenMarket } from "@/lib/wallets/scoring";

const W = "Wallet1111111111111111111111111111111111111";
const POOL = "Pool111111111111111111111111111111111111111";
const MEME = "Meme111111111111111111111111111111111111pump";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const bal = (accountIndex: number, mint: string, owner: string, ui: number, decimals = 6) => ({
  accountIndex, mint, owner, uiTokenAmount: { amount: String(Math.round(ui * 10 ** decimals)), decimals },
});

function tx(opts: { solDelta: number; pre?: ReturnType<typeof bal>[]; post?: ReturnType<typeof bal>[]; signer?: boolean; err?: unknown; time?: number }): RawTx {
  const pre = 10e9;
  return {
    slot: 100,
    blockTime: opts.time ?? 1_790_000_000,
    transaction: { signatures: ["sig"], message: { accountKeys: [{ pubkey: W, signer: opts.signer ?? true }, { pubkey: POOL }] } },
    meta: { err: opts.err ?? null, fee: 5000, preBalances: [pre, 0], postBalances: [pre + opts.solDelta * 1e9, 0], preTokenBalances: opts.pre ?? [], postTokenBalances: opts.post ?? [] },
  };
}

describe("extractSwap", () => {
  it("reads a SOL -> token buy from balance deltas", () => {
    const s = extractSwap(W, tx({ solDelta: -1.5, post: [bal(2, MEME, W, 1_000_000)] }), 150);
    expect(s).toMatchObject({ side: "buy", mint: MEME, tokenAmount: 1_000_000 });
    expect(s!.sol).toBeCloseTo(1.5);
  });

  it("reads a token -> WSOL sell and counts the WSOL leg as SOL", () => {
    const s = extractSwap(W, tx({ solDelta: 0, pre: [bal(2, MEME, W, 500)], post: [bal(2, MEME, W, 0), bal(3, WSOL, W, 2, 9)] }), 150);
    expect(s).toMatchObject({ side: "sell", mint: MEME, tokenAmount: 500 });
    expect(s!.sol).toBeCloseTo(2);
  });

  it("converts a stablecoin quote at the given SOL price", () => {
    const s = extractSwap(W, tx({ solDelta: -0.000005, pre: [bal(3, USDC, W, 300)], post: [bal(3, USDC, W, 0), bal(2, MEME, W, 10)] }), 150);
    expect(s?.side).toBe("buy");
    expect(s!.sol).toBeCloseTo(2, 3);
  });

  it("ignores transfers where only fees or rent moved", () => {
    expect(extractSwap(W, tx({ solDelta: -0.00204, post: [bal(2, MEME, W, 1000)] }), 150)).toBeNull();
  });

  it("ignores failed, non-signer and multi-token transactions", () => {
    expect(extractSwap(W, tx({ solDelta: -1, post: [bal(2, MEME, W, 1)], err: { InstructionError: [] } }), 150)).toBeNull();
    expect(extractSwap(W, tx({ solDelta: -1, post: [bal(2, MEME, W, 1)], signer: false }), 150)).toBeNull();
    expect(extractSwap(W, tx({ solDelta: -1, post: [bal(2, MEME, W, 1), bal(4, "Other1111111111111111111111111111111111111", W, 5)] }), 150)).toBeNull();
  });

  it("ignores balances owned by other accounts (e.g. the pool)", () => {
    expect(extractSwap(W, tx({ solDelta: -1, post: [bal(2, MEME, POOL, 1000)] }), 150)).toBeNull();
  });
});

describe("extractTrades (watching followed wallets)", () => {
  const OTHER = "Other1111111111111111111111111111111111pump";
  it("returns the SOL swap as extractSwap sees it", () => {
    const t = extractTrades(W, tx({ solDelta: -1.5, post: [bal(2, MEME, W, 1_000)] }), 150);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ side: "buy", mint: MEME });
    expect(t[0].sol).toBeCloseTo(1.5);
  });

  it("splits a memecoin -> memecoin swap into a sell and a buy with no SOL value", () => {
    const t = extractTrades(W, tx({ solDelta: -0.000005, pre: [bal(2, MEME, W, 500)], post: [bal(2, MEME, W, 0), bal(4, OTHER, W, 9_000)] }), 150);
    expect(t.map((x) => [x.side, x.mint, x.tokenAmount, x.sol])).toEqual([["sell", MEME, 500, null], ["buy", OTHER, 9_000, null]]);
  });

  it("ignores two tokens moving the same way, transfers and other signers", () => {
    expect(extractTrades(W, tx({ solDelta: -0.000005, post: [bal(2, MEME, W, 1), bal(4, OTHER, W, 5)] }), 150)).toEqual([]);
    expect(extractTrades(W, tx({ solDelta: -0.000005, pre: [bal(2, MEME, W, 5)], post: [bal(2, MEME, W, 0)] }), 150)).toEqual([]);
    expect(extractTrades(W, tx({ solDelta: 0, signer: false, pre: [bal(2, MEME, W, 5)], post: [bal(2, MEME, W, 0), bal(4, OTHER, W, 5)] }), 150)).toEqual([]);
  });
});

const swap = (mint: string, side: "buy" | "sell", sol: number, tokenAmount: number, time: number): Swap => ({ signature: `${mint}${time}`, slot: time, time, mint, side, sol, tokenAmount });

describe("positions and scoring", () => {
  const now = 1_790_000_000;
  const day = 86_400;

  it("drops sells without a recorded buy (no cost basis)", () => {
    const p = buildPositions([swap("A", "sell", 3, 100, now)]);
    expect(p).toHaveLength(0);
  });

  it("classifies closed, dead and open positions", () => {
    const positions = buildPositions([
      swap("WIN", "buy", 1, 100, now - 5 * day), swap("WIN", "sell", 3, 100, now - 4 * day),
      swap("RUG", "buy", 2, 100, now - 5 * day),
      swap("HOLD", "buy", 1, 100, now - 3600),
    ]);
    const markets = new Map<string, TokenMarket | null>([
      ["WIN", { priceUsd: 0.01, liquidityUsd: 50_000, launchedAt: now - 5 * day - 600 }],
      ["RUG", null],
      ["HOLD", { priceUsd: 3, liquidityUsd: 80_000, launchedAt: now - 30 * day }],
    ]);
    const ev = new Map(evaluatePositions(positions, markets, 150, now).map((p) => [p.mint, p]));
    expect(ev.get("WIN")).toMatchObject({ status: "closed", pnlSol: 2, early: true, hit: true });
    expect(ev.get("RUG")).toMatchObject({ status: "dead", pnlSol: -2, early: false });
    expect(ev.get("HOLD")).toMatchObject({ status: "open", early: false });
    expect(ev.get("HOLD")!.heldValueSol).toBeCloseTo(2); // 100 tokens * $3 / $150
  });

  it("does not treat a bonding-curve token (no liquidity reported) as dead", () => {
    const positions = buildPositions([swap("CURVE", "buy", 1, 1000, now - 3 * day)]);
    const markets = new Map<string, TokenMarket | null>([["CURVE", { priceUsd: 0.3, liquidityUsd: null, launchedAt: now - 3 * day - 60 }]]);
    const [p] = evaluatePositions(positions, markets, 150, now);
    expect(p.status).toBe("open");
    expect(p.heldValueSol).toBeCloseTo(2); // 1000 tokens * $0.30 / $150
  });

  it("withholds a score below the minimum sample and scores larger samples", () => {
    const mk = (n: number, winEvery: number) => {
      const swaps: Swap[] = [];
      for (let i = 0; i < n; i++) {
        swaps.push(swap(`T${i}`, "buy", 1, 100, now - 10 * day + i * 3600));
        swaps.push(swap(`T${i}`, "sell", i % winEvery === 0 ? 2.5 : 0.5, 100, now - 10 * day + i * 3600 + 1800));
      }
      return swaps;
    };
    const small = mk(3, 1);
    expect(scoreWallet(evaluatePositions(buildPositions(small), new Map(), 150, now), small, 30).score).toBeNull();

    const good = mk(12, 1);
    const bad = mk(12, 4);
    const sGood = scoreWallet(evaluatePositions(buildPositions(good), new Map(), 150, now), good, 30);
    const sBad = scoreWallet(evaluatePositions(buildPositions(bad), new Map(), 150, now), bad, 30);
    expect(sGood).toMatchObject({ wins: 12, losses: 0, decided: 12, botLike: false });
    expect(sGood.pnlSol).toBeCloseTo(18);
    expect(sBad.wins).toBe(3);
    expect(sGood.score!).toBeGreaterThan(sBad.score!);
  });

  it("ignores dust positions when judging win rate", () => {
    const swaps: Swap[] = [];
    for (let i = 0; i < 20; i++) {
      swaps.push(swap(`D${i}`, "buy", 0.02, 100, now - 10 * day + i * 3600));
      swaps.push(swap(`D${i}`, "sell", 0.05, 100, now - 10 * day + i * 3600 + 900));
    }
    const s = scoreWallet(evaluatePositions(buildPositions(swaps), new Map(), 150, now), swaps, 30);
    expect(s).toMatchObject({ decided: 0, score: null, trades: 40 });
  });

  it("discounts bot-like wallets", () => {
    const swaps: Swap[] = [];
    for (let i = 0; i < 12; i++) {
      swaps.push(swap(`B${i}`, "buy", 1, 100, now - day + i * 100));
      swaps.push(swap(`B${i}`, "sell", 2, 100, now - day + i * 100 + 30)); // 30-second holds
    }
    const s = scoreWallet(evaluatePositions(buildPositions(swaps), new Map(), 150, now), swaps, 30);
    expect(s.botLike).toBe(true);
    expect(s.medianHoldMinutes).toBeCloseTo(0.5);
  });
});
