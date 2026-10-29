# Known limitations & estimated operating costs

## Data & product limitations

- **No 7-day price change**: DexScreener provides 5m/1h/6h/24h only; 7d is shown as unavailable rather than computed from sparse data.
- **Holder counts** come from GoPlus security reports and are refreshed on the security TTL, not every cycle.
- **Transaction counts are not sizes**: buy/sell imbalance counts transactions; many small buys can coexist with a few large sells. This is disclosed in the UI and methodology.
- **GoPlus answers one token per request** (verified Oct 2026), so security checks are bounded to 15 per chain per cycle; new tokens may briefly show "Unverified".
- **GoPlus Solana** does not provide honeypot simulation or LP-lock status; those checks are shown as unavailable.
- **GeckoTerminal keyless tier** throttles at roughly 10 req/min: candles (volatility factor and scenario levels) are fetched for at most 3 eligible tokens per cycle and cached 5 min. A paid CoinGecko API key would lift this (adapter change: base URL + header).
- **Smart Money** depends on administrators adding documented public wallets; none are pre-loaded (we do not ship unverifiable labels).
- **Signals refresh per ingestion cycle** (~2 min by default), not per block. The UI shows data age everywhere.
- **Measured outcomes** use SOLME's own snapshots and only cover tokens that stayed in the ingestion set; they ignore fees and slippage.
- **OAuth sign-in** is not implemented (email + password with verification/reset is). Adding Google/GitHub OAuth would plug into `createSession()`.
- **Email verification** is required for email alerts and checkout, not for basic use.
- **Stripe** integration is implemented and unit-tested with signed payloads and simulated events, but **was not run against a live Stripe account** here. Run the staging checklist in DEPLOYMENT.md. Crypto payments are not implemented.
- **AI** chat was implemented against the Anthropic SDK (v1.3) but **not exercised without an API key** here; the deterministic report path is fully tested.
- **Legal pages** are product-specific templates and need review by counsel for your jurisdictions.
- Daily AI quota checks are not transactional; concurrent requests can exceed the quota by a request or two (bounded by the 6/min rate limit).

## Estimated monthly third-party costs (USD, order-of-magnitude; verify current pricing)

| Item | Starter (≤1k users) | Growth (≈10k users) | Notes |
|---|---|---|---|
| Web hosting (Vercel Pro or equivalent) | $20 | $20–150 | Bandwidth/function usage scale with traffic. |
| Worker process (Railway/Render/Fly) | $5–10 | $10–25 | One small always-on instance is enough; ingestion is centralized. |
| PostgreSQL (Neon/Supabase/Railway) | $0–25 | $25–100 | Snapshots dominate storage (~100–150 tokens × 720 cycles/day); retention is configurable. |
| DexScreener / GoPlus | $0 | $0–? | Keyless tiers today; confirm commercial terms and rate limits at scale. |
| GeckoTerminal / CoinGecko API | $0 | ~$129+ | Paid tier recommended for more candle coverage. |
| Helius (Solana wallets) | $0–49 | $49–499 | Depends on tracked wallets × sync frequency. |
| Anthropic (AI) | $20–200 | $500–3,000 | Driven by plan quotas (5/50/200 replies/day). At list pricing for `claude-opus-5-5` ($4/$20 per MTok) a typical grounded reply with tool results is ~$0.03–0.10; reports at high effort more. The admin panel tracks actual cost. Lower via `AI_EFFORT`, quotas, or a cheaper `AI_MODEL`. |
| Resend (email) | $0–20 | $20–90 | Alerts can be high-volume; cooldowns and per-channel opt-in limit this. |
| Stripe | 2.9% + 30¢ per charge (US cards) | same | Plus Stripe Tax/Billing fees if enabled. |
| Telegram | $0 | $0 | Bot API is free (rate limits apply). |
