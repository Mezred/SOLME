export const FAQ: { q: string; a: string }[] = [
  {
    q: "What exactly is a NEXALPHA signal?",
    a: "A signal is a timestamped record that a token's live market data matched one of five documented patterns — momentum, accumulation, breakout watch, distribution or high risk — together with its factor scores, the evidence behind each score, missing data and risk flags. It is research context, not a recommendation to buy or sell.",
  },
  {
    q: "How is the AI score calculated?",
    a: "Deterministically, from up to eleven factors (momentum, volume acceleration, buy/sell imbalance, liquidity depth, liquidity-to-market-cap, holder distribution, pair age, trading activity, volatility, Smart Money flow and market regime) with weights that are stored on our servers. Missing factors are excluded rather than guessed, and security findings cap or reduce the score. The language model only explains the result; it never calculates it. See the Methodology page for every formula.",
  },
  {
    q: "Is a high score a guarantee the price will go up?",
    a: "No. Scores summarize current, observable conditions. Crypto prices are driven by many things no model can see. We publish measured outcomes of past signals on the Signal History page — including the ones that went down.",
  },
  {
    q: "Which blockchains are supported?",
    a: "Solana, Ethereum, BNB Smart Chain and Base. The engine is built on a chain registry so additional EVM networks can be added.",
  },
  {
    q: "Where does the data come from?",
    a: "Market data comes from DexScreener and GeckoTerminal, token security checks from GoPlus Security, and — when configured — wallet activity from Helius (Solana) and Alchemy (Ethereum, Base). Every data point shows its provider and timestamp, and stale data is labeled.",
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
    a: "Never. NEXALPHA is read-only research software. Portfolio tracking uses trades you enter manually; we never custody funds or ask for keys or seed phrases.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Paid plans renew monthly or annually and can be cancelled from Billing; access continues until the end of the paid period.",
  },
  {
    q: "Are signals real-time?",
    a: "Signals are generated each ingestion cycle (about every two minutes by default) from provider data that is itself near-real-time. Free plan signals are delayed 15 minutes. We show the age of every data point rather than claiming instant updates.",
  },
];
