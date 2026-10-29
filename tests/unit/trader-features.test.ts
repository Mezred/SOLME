import { describe, expect, it } from "vitest";
import { escapeMarkdown } from "@/lib/alerts/engine";
import { alertRuleInput } from "@/lib/alerts/rules";
import type { RawTx } from "@/lib/providers/helius-history";
import { analyseLaunch } from "@/lib/tokens/holders";

const MINT = "Mint111111111111111111111111111111111111pump";
const DEV = "Dev1111111111111111111111111111111111111111";

/** A buy of `tokens` for `sol` by `signer`, in `slot` at `time`. */
function buy(signer: string, tokens: number, sol: number, slot: number, time: number): RawTx {
  return {
    slot,
    blockTime: time,
    transaction: { signatures: [`${signer}-${slot}`], message: { accountKeys: [{ pubkey: signer, signer: true }] } },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [100e9],
      postBalances: [100e9 - sol * 1e9],
      preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: signer, uiTokenAmount: { amount: String(tokens * 1e6), decimals: 6 } }],
    },
  };
}

describe("analyseLaunch", () => {
  it("separates the dev buy, launch-block bundle buys and first-10s snipers", () => {
    const t0 = 1_790_000_000;
    const txs = [
      buy(DEV, 20_000_000, 1, 100, t0), // creation tx incl. dev buy
      buy("BundleA111111111111111111111111111111111111", 30_000_000, 2, 100, t0),
      buy("BundleB111111111111111111111111111111111111", 20_000_000, 1.5, 100, t0),
      buy("Sniper1111111111111111111111111111111111111", 10_000_000, 1, 101, t0 + 3),
      buy("Late11111111111111111111111111111111111111", 50_000_000, 5, 140, t0 + 60), // outside the window
    ];
    const r = analyseLaunch(MINT, txs, 1_000_000_000, 150)!;
    expect(r.creator).toBe(DEV);
    expect(r.devBuyPct).toBeCloseTo(2);
    expect(r.bundleWallets).toBe(2);
    expect(r.bundlePct).toBeCloseTo(5);
    expect(r.sniperWallets).toBe(1);
    expect(r.sniperPct).toBeCloseTo(1);
    expect(r.buyers.has("Late11111111111111111111111111111111111111")).toBe(false);
  });

  it("returns null without any successful transaction", () => {
    expect(analyseLaunch(MINT, [], 1e9, 150)).toBeNull();
  });
});

describe("Telegram Markdown escaping", () => {
  it("escapes characters that make Telegram reject the message", () => {
    expect(escapeMarkdown("PEPE_2.0 *moon* [x] `y`")).toBe("PEPE\\_2.0 \\*moon\\* \\[x] \\`y\\`");
  });
});

describe("new alert rule schemas", () => {
  const base = { name: "x", chain: null, token_id: null, wallet_id: null, channels: ["in_app"], cooldown_minutes: 60 };
  it("accepts valid launchpad and smart-wallet rules without a token", () => {
    expect(alertRuleInput.safeParse({ ...base, rule_type: "dev_deploy", params: { min_dev_score: 60 } }).success).toBe(true);
    expect(alertRuleInput.safeParse({ ...base, rule_type: "curve_progress", params: { min_progress: 80, min_dev_score: 40 } }).success).toBe(true);
    expect(alertRuleInput.safeParse({ ...base, rule_type: "smart_wallet_buy", params: { min_wallet_score: 60, min_buy_sol: 0.5 } }).success).toBe(true);
  });
  it("rejects out-of-range thresholds", () => {
    expect(alertRuleInput.safeParse({ ...base, rule_type: "curve_progress", params: { min_progress: 20, min_dev_score: 0 } }).success).toBe(false);
    expect(alertRuleInput.safeParse({ ...base, rule_type: "dev_deploy", params: { min_dev_score: 0 } }).success).toBe(false);
  });
});
