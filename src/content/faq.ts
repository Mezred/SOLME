/** `steps`: an optional numbered list shown under the answer (e.g. a routine to follow). */
export const FAQ: { q: string; a: string; steps?: string[] }[] = [
  {
    q: "What is a proven dev?",
    a: "A token creator with two or more recorded launches whose dev score is 60+, which means at least one earlier launch migrated and held its value afterwards (no dump by the dev). Wallets funded by the same wallet share one record. SOLME shows their new launches within seconds and runs a background scam check on each. A good record does not make a new launch safe: open the coin for the full check before you buy.",
  },
  {
    q: "How do I decide quickly whether to buy a coin?",
    a: "Look for reasons to say no first: most coins fail in the first seconds, which is what saves time. Coin Check answers five questions for you (can I sell it, is the liquidity real, who controls it, are insiders set to dump, is the trading genuine) and gives one verdict. Follow the steps in order and stop at the first fail; it takes under a minute. This is a research routine, not financial advice: only trade what you can afford to lose entirely.",
    steps: [
      "Pick candidates only from a filter: a Telegram alert (Early Coins, proven-dev launch, group buy, smart-wallet buy, followed-wallet trade) or the Early Coins feed. Never from a random tip.",
      "Send the contract to the bot or open Coin Check. Avoid means skip, whatever else you see: any of the five questions failed (for example the simulated sell fails or hides a tax, liquidity was pulled, mint or freeze authority is on, dev-linked wallets hold 10%+, or wash trading).",
      "Can I sell it? The sell test must say you'd get your money out with no hidden tax, at an exit cost under about 6% for your size. A failed or taxed sell is a trap: never 'try a small buy to see'.",
      "Who holds it? Read the insiders line: top 10 under 30%, dev under 5%, snipers and bundlers mostly gone, and no cluster of wallets funded by the dev or by one wallet. One warning is acceptable; two is a no.",
      "A real reason to buy. Tradeable needs at least one: smart wallets bought (best: a group buy, by wallets marked 'held up'), a proven dev, or strong buy flow that the trading check calls genuine. Clean checks with no reason to buy is Watch: wait for one, don't invent it.",
      "Timing. Early or mid-move is fine. A vertical move (+40% in 5 minutes) means wait for a pullback; dumping means wait for it to hold a level. Set a price alert instead of chasing.",
      "Plan the exit before you buy. A fixed small size per trade (for example 1–2% of your trading wallet). Take your initial out at 2× and let the rest ride. Sell straight away on a dev-sold, smart-wallet-sold or liquidity-drop alert, or on a 30–40% drop.",
    ],
  },
  {
    q: "How is the score calculated?",
    a: "Deterministically, from up to eleven factors (momentum, volume acceleration, buy/sell imbalance, liquidity depth, liquidity-to-market-cap, holder distribution, pair age, trading activity, volatility, Smart Money flow and market regime) with weights that are stored on our servers. Missing factors are excluded rather than guessed, and security findings cap or reduce the score. See the Methodology page for every formula.",
  },
  {
    q: "Is a high score a guarantee the price will go up?",
    a: "No. Scores summarize current, observable conditions. Crypto prices are driven by many things no model can see. Treat every score as one input, not a signal to buy.",
  },
  {
    q: "Which blockchains are supported?",
    a: "Solana: pump.fun, LetsBonk, PumpSwap, Raydium, Meteora and every other Solana DEX that DexScreener lists.",
  },
  {
    q: "Where does the data come from?",
    a: "Market data comes from DexScreener and GeckoTerminal, token security checks from GoPlus Security, on-chain reads and wallet activity from Helius, and launches from PumpPortal. Every data point shows its provider and timestamp, and stale data is labeled.",
  },
  {
    q: "Does a passed security check mean a token is safe?",
    a: "No. Automated checks catch known patterns such as honeypots, active mint or freeze authority, high taxes or blacklist functions. They cannot catch every trap, and some checks are not available on every chain. Missing results are always shown as “unverified”, never as clean.",
  },
  {
    q: "How does Smart Money tracking work?",
    a: "We only call a wallet a whale, fund or Smart Money wallet when the label has a documented source or you labeled it yourself. You can track any public wallet; we show its transfers and swaps from the configured blockchain data provider.",
  },
  {
    q: "Do you need my private keys or deposits?",
    a: "Never. SOLME is read-only research software. We never custody funds or ask for keys or seed phrases.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, there is nothing to cancel. Plans are paid in USDC or SOL on Solana for a month or a year and never renew by themselves. You get a reminder 3 days before yours ends; if you don't pay again, you go back to Free.",
  },
  {
    q: "Is the data real-time?",
    a: "Data refreshes each ingestion cycle (about every two minutes by default) from provider data that is itself near-real-time. We show the age of every data point rather than claiming instant updates.",
  },
];
