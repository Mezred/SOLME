import { describe, expect, it } from "vitest";
import { handleMessage, mayBeSwap } from "@/lib/wallets/live";

const wallet = { id: "w1", address: "SmartWa11et1111111111111111111111111111111" };
const state = () => ({ subs: new Map<number, typeof wallet>(), byWallet: new Map<string, number>(), requests: new Map([[7, wallet]]), queue: [] as { wallet: typeof wallet; signature: string; tries: number }[] });
const note = (sub: number, signature: string, logs: string[], err: unknown = null) => ({
  method: "logsNotification",
  params: { subscription: sub, result: { value: { signature, err, logs } } },
});

const PUMP = "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]";
const TRANSFER = ["Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success"];

describe("smart wallet live feed", () => {
  it("treats plain transfers as noise and anything touching a DEX or launchpad as a possible swap", () => {
    expect(mayBeSwap(TRANSFER)).toBe(false);
    expect(mayBeSwap(["Program ComputeBudget111111111111111111111111111111 invoke [1]", PUMP])).toBe(true);
    expect(mayBeSwap([])).toBe(false);
  });

  it("maps the subscription reply to the wallet, then queues its possible swaps once", () => {
    const s = state();
    handleMessage(s, { id: 7, result: 4242 });
    expect(s.subs.get(4242)).toEqual(wallet);
    expect(s.byWallet.get("w1")).toBe(4242);
    expect(s.requests.size).toBe(0);

    handleMessage(s, note(4242, "sigA", [PUMP]));
    handleMessage(s, note(4242, "sigA", [PUMP])); // duplicate notification
    handleMessage(s, note(4242, "sigB", TRANSFER)); // transfer: skipped, costs nothing
    handleMessage(s, note(4242, "sigC", [PUMP], { InstructionError: [0, "Custom"] })); // failed tx
    handleMessage(s, note(999, "sigD", [PUMP])); // unknown subscription
    expect(s.queue.map((q) => q.signature)).toEqual(["sigA"]);
  });
});
