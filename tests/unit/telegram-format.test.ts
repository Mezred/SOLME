import { describe, expect, it } from "vitest";
import { formatTelegramAlert, launchCheckToAlert, usd } from "@/lib/alerts/telegram-format";

const MINT = "9MGMMbtNPaVKjp2iwydnTM9rZTnGnB77xgUMQnASbJjP";

describe("Telegram alert layout", () => {
  it("puts the contract on its own tap-to-copy line with facts and link buttons", () => {
    const m = formatTelegramAlert(
      { icon: "🚀", headline: "Proven dev just launched", symbol: "BACKED", chain: "solana", pool: "pump", address: MINT, facts: [["Dev score", "75"]], note: "Not safe by default." },
      "http://localhost:3000/app/smart-dev",
    );
    expect(m.text.split("\n")).toEqual([
      "🚀 <b>PROVEN DEV JUST LAUNCHED</b>",
      "",
      "<b>$BACKED</b> · Solana · pump.fun",
      `<code>${MINT}</code>`,
      "",
      "• Dev score: <b>75</b>",
      "",
      "<i>Not safe by default.</i>",
    ]);
    // No SOLME button for a localhost URL (Telegram rejects it); public links in rows of two.
    expect(m.buttons).toEqual([
      [{ text: "DexScreener", url: `https://dexscreener.com/solana/${MINT}` }, { text: "pump.fun", url: `https://pump.fun/coin/${MINT}` }],
      [{ text: "Explorer", url: `https://solscan.io/account/${MINT}` }],
    ]);
  });

  it("adds the SOLME button on a public https URL and escapes untrusted names", () => {
    const m = formatTelegramAlert({ icon: "🐋", headline: "Smart wallet bought", symbol: "<b>&EVIL", chain: "solana", address: MINT, facts: [["Spent", "2 SOL"]] }, "https://solme.app/app/token/solana/x");
    expect(m.text).toContain("<b>$&lt;b&gt;&amp;EVIL</b>");
    expect(m.buttons[0][0]).toEqual({ text: "SOLME", url: "https://solme.app/app/token/solana/x" });
  });

  it("works without a coin (no address line, no buttons)", () => {
    const m = formatTelegramAlert({ icon: "✅", headline: "Test", facts: [] }, null);
    expect(m.text).toBe("✅ <b>TEST</b>");
    expect(m.buttons).toEqual([]);
  });

  it("shows the scam-check state, escaping the reason", () => {
    const base = { icon: "🚀", headline: "Proven dev just launched", facts: [] as [string, string][] };
    expect(formatTelegramAlert({ ...base, check: { status: "pending" } }, null).text).toContain("⏳ <b>Scam check running…</b>");
    expect(formatTelegramAlert({ ...base, check: { status: "failed", reason: "Top 10 hold <90%>" } }, null).text).toContain("❌ <b>Scam check failed</b> — Top 10 hold &lt;90%&gt;");
    expect(launchCheckToAlert({ passed: null, reason: "Check failed, will retry" })).toEqual({ status: "pending" });
    expect(launchCheckToAlert({ passed: null, reason: "No DEX market yet" })).toEqual({ status: "no_market" });
  });

  it("formats compact dollar amounts", () => {
    expect([usd(3578), usd(1_240_000), usd(0.00042), usd(null)]).toEqual(["$3.6K", "$1.24M", "$0.000420", "n/a"]);
  });
});
