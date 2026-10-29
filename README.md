# SOLME

Research terminal for **Solana memecoin traders**. It finds coins worth a look (proven-dev launches, smart-wallet buys, a DexScreener-grade screener), checks them before you buy (a five-question Coin Check with a simulated sell), and alerts you on Telegram within seconds. Subscriptions are paid by card (Stripe) or with USDC / SOL (Solana Pay), and an admin panel runs the platform.

> Crypto assets are volatile. SOLME is a research tool, not financial advice and not a guarantee of any outcome.

## Features

| Area | What it does |
|---|---|
| **Coin Check** | One verdict (Tradeable / Watch / Avoid) and a 0–100 safety score, built from five questions:<br>1. **Can I sell it?** A real sell is built through Jupiter for a wallet that holds the coin and simulated on-chain (never sent). It checks for a hidden tax, the real exit cost, freeze authority, transfer hooks and delegates.<br>2. **Is the liquidity real?** Pool size, real SOL in the pool, market cap vs pool, LP burned, liquidity pulled recently.<br>3. **Who controls it?** Mint, balance and metadata authorities, the dev wallet, the dev's launch record.<br>4. **Are insiders set to dump?** Top holders, launch bundle, snipers, dev sells, and holders traced to the dev or to one funder.<br>5. **Is the trading genuine?** Volume bots, wallets trading in circles, one wallet driving volume.<br><br>It also lists reasons to buy (smart wallets, a proven dev, genuine buy flow), what would make a Watch buy-ready, and an exit plan. Works on the web and by sending a contract to the Telegram bot. |
| **Proven Devs** | Live pump.fun and LetsBonk launches from creators whose earlier coins migrated and held (dev score v2: linked wallets, outcomes, confidence). Each launch is scam-checked automatically. |
| **Smart Wallets** | Wallets discovered as early buyers of coins that pumped. They are scored on 30 days of trades, with a holdout test and penalties for insiders and bots, and watched live. Includes "if you copied" returns, group buys, and follow-up alerts when a wallet sells. |
| **Followed wallets** | Follow any wallet to get every buy and sell it makes, in any coin, within seconds. Each alert shows the SOL spent, the price, the market cap, and the % since the wallet's buy. |
| **Screener** | Every DexScreener filter: liquidity, market cap, FDV, age, volume, transactions, buys and sells on 5m/1h/6h/24h, price change, buy share, market cap ÷ liquidity, DEX, launchpad, socials, boosts, dev score, scam check. Also one-tap quick scans and saved templates that can alert you. |
| **Alerts** | Telegram, email and in-app. Edited in place when a check finishes, threaded replies for sells, 🔕 mute buttons, quiet hours with a digest. |
| **Billing** | Free / Pro / Elite plans, enforced on the server. Card subscriptions via Stripe; prepaid crypto subscriptions in USDC or SOL, confirmed on-chain, with renewal reminders. |
| **Admin** | Users, plans and prices, subscriptions and payments, providers and feed health, ingestion, scoring, logs, support. |

## Quick start (local)

Requirements: Node.js 20.9+ (tested on 24), npm.

```bash
npm install
npx playwright install chromium     # only needed for e2e tests
cp .env.example .env.local          # then add the keys you have (see below)
npm run dev                         # http://localhost:3000
```

With no keys at all you still get:

- An embedded PostgreSQL (PGlite) in `.data/pglite` (move it with `PGLITE_DIR`), migrated automatically on start.
- An in-process background worker that ingests live market data from DexScreener, GeckoTerminal and GoPlus (all keyless) every ~2 minutes.
- Emails printed to the server console (verification and reset links are also shown on screen in development).

**For the features traders use every day, add `HELIUS_API_KEY`.** It powers launches, holder analysis, the sell simulation, smart wallets and followed wallets. **Add `TELEGRAM_BOT_TOKEN`** to get alerts on Telegram.

Sign up at `/signup`. To make yourself an admin, set `BOOTSTRAP_ADMIN_EMAIL` before signing up, or use the seed accounts:

```bash
# PGlite allows one process per data dir: stop `npm run dev` first.
npm run db:seed
```

Seed accounts (password `nexalpha-demo-2026`, override with `SEED_PASSWORD`): `admin@`, `elite@`, `pro@`, `free@nexalpha.local`. Paid plans on seed accounts are audited **admin grants**, not payments.

### Demo mode

`DEMO_MODE=true` replaces live ingestion with a synthetic dataset. Every demo row is flagged `is_demo` and token names are prefixed `[DEMO]`. The dashboard shows a persistent banner, and queries never mix demo and live rows.

## Configuration

All keys go in `.env.local`, which git ignores. **Never commit secrets.** For crypto payments you only ever enter a **public** wallet address, never a private key or seed phrase.

| Feature | Variables | Without them |
|---|---|---|
| Production database | `DATABASE_URL` | Embedded PGlite (dev only; production refuses to start) |
| On-chain data: launches, holders, sell simulation, smart & followed wallets | `HELIUS_API_KEY` | Market data and contract checks only |
| Telegram alerts and the contract-check bot | `TELEGRAM_BOT_TOKEN` | Telegram unavailable |
| Card subscriptions | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` + Price IDs in Admin → Pricing | Card checkout hidden; admins can grant plans (audited) |
| Crypto subscriptions (USDC / SOL) | `SOLANA_PAY_RECIPIENT` (your wallet's public address) + `HELIUS_API_KEY` | "Pay with crypto" hidden |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Emails logged, not sent |
| Higher GoPlus limits | `GOPLUS_APP_KEY`, `GOPLUS_APP_SECRET` | Keyless tier (~25 checks/min) |
| GMGN referral on "Trade on GMGN" buttons | `GMGN_REFERRAL_CODE` | Plain links |
| Cron-triggered jobs | `CRON_SECRET` | `/api/cron/tick` rejects all calls |
| Other Jupiter endpoint | `JUPITER_API_BASE` | Free `lite-api.jup.ag` |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server, plus the in-process worker when using PGlite |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Standalone background worker (production with Postgres) |
| `npm run ingest` | Run one ingestion cycle and print a summary |
| `npm run db:migrate` | Apply SQL migrations to `DATABASE_URL` |
| `npm run db:seed` | Seed dev/staging accounts and sample data |
| `npm run db:copy-to-postgres` | Copy the local PGlite database into `DATABASE_URL` (moving to production) |
| `npm test` | Unit and integration tests (Vitest, in-memory Postgres) |
| `npm run test:e2e` | End-to-end tests (Playwright; starts or reuses the dev server) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

After changing code under `src/lib` that the worker runs (alerts, wallets, launches, billing jobs), restart `npm run dev`: the in-process worker does not hot-reload.

## Project layout

| Path | Contents |
|---|---|
| `src/app/(marketing)` | Public site: home, features, pricing, FAQ, methodology, legal |
| `src/app/app` | The terminal: Overview, Screener, Check a coin, Proven Devs, Smart Wallets, Wallets, Watchlist, Alerts, Billing, Settings |
| `src/app/admin` | Admin panel |
| `src/lib/decision` | The Coin Check verdict (pure rules) and the evidence it reads |
| `src/lib/tokens` | Holder analysis and the investigation (sell simulation, connected holders, pool depth, trading patterns) |
| `src/lib/launchpad` | pump.fun / LetsBonk launch stream, dev scores, launch checks |
| `src/lib/wallets` | Smart-wallet discovery, scoring, live feed, copy stats |
| `src/lib/alerts` | Alert rules, engine, Telegram formatting and bot |
| `src/lib/billing` | Plans, entitlements, Stripe, crypto payments |
| `src/lib/providers` | DexScreener, GeckoTerminal, GoPlus, Helius, Jupiter clients |
| `db/migrations` | SQL migrations (embedded at build time) |

## Documentation

- [Architecture & data model](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Deployment & operations](docs/DEPLOYMENT.md): includes Stripe and crypto payment setup
- [Limitations & operating costs](docs/LIMITATIONS_AND_COSTS.md)
- Methodology: rendered live at `/methodology`.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (node-postgres / PGlite) with SQL migrations and row-level security · Zod · Helius RPC & websockets · Jupiter · DexScreener · GoPlus · Stripe REST · Solana Pay · Telegram Bot API · Vitest · Playwright.
