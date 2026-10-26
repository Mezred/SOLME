# NEXALPHA

On-chain signal intelligence for DEX traders on **Solana, Ethereum, BNB Smart Chain and Base**: a live signal feed, explainable deterministic scoring, token security checks, wallet intelligence, alerts, portfolio tracking, AI research grounded in stored evidence, subscriptions, and an admin panel.

> Crypto assets are volatile. NEXALPHA is a research tool — not financial advice and not a guarantee of any outcome.

## Quick start (local, no accounts needed)

Requirements: Node.js 20.9+ (tested on 24), npm.

```bash
npm install
npx playwright install chromium     # only needed for e2e tests
cp .env.example .env.local          # optional — everything works without keys
npm run dev                         # http://localhost:3000
```

What you get with zero configuration:

- An embedded PostgreSQL (PGlite) in `.data/pglite`, migrated automatically on first request.
- An in-process background worker that ingests **real live data** from DexScreener, GeckoTerminal and GoPlus (all keyless) every ~2 minutes and produces signals.
- Email is logged to the server console (verification/reset links are also shown on screen in development).

Sign up at `/signup`. To make yourself an admin, set `BOOTSTRAP_ADMIN_EMAIL` before signing up, or use the seed accounts:

```bash
# PGlite allows one process per data dir — stop `npm run dev` first.
npm run db:seed
```

Seed accounts (password `nexalpha-demo-2026`, override with `SEED_PASSWORD`): `admin@`, `elite@`, `pro@`, `free@nexalpha.local`. Paid plans on seed accounts are audited **admin grants**, not payments.

### Demo mode

`DEMO_MODE=true` replaces live ingestion with a synthetic dataset. Every demo row is flagged `is_demo`, token names are prefixed `[DEMO]`, the dashboard shows a persistent banner, and demo and live rows are never mixed in queries.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (+ in-process worker when using PGlite) |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Standalone background worker (production with Postgres) |
| `npm run ingest` | Run one ingestion cycle and print a summary |
| `npm run db:migrate` | Apply SQL migrations to `DATABASE_URL` |
| `npm run db:seed` | Seed dev/staging accounts and sample data |
| `npm test` | Unit + integration tests (Vitest, in-memory Postgres) |
| `npm run test:e2e` | End-to-end tests (Playwright; starts/reuses the dev server) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## Documentation

- [Architecture & data model](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Deployment & operations](docs/DEPLOYMENT.md)
- [Limitations & operating costs](docs/LIMITATIONS_AND_COSTS.md)
- Scoring methodology: rendered live at `/methodology` from the engine's configuration.

## Configuration that activates optional integrations

| Feature | Variables | Without them |
|---|---|---|
| Production database | `DATABASE_URL` | Embedded PGlite (dev only; production refuses to start) |
| AI chat & reports | `ANTHROPIC_API_KEY` (`AI_MODEL`, `AI_EFFORT`) | AI pages show "not configured"; deterministic reports still work |
| Subscriptions | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` + Price IDs in Admin → Pricing | Paid plans not purchasable; admins can grant plans (audited) |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Emails logged, not sent |
| Telegram alerts | `TELEGRAM_BOT_TOKEN` | Telegram channel unavailable |
| Solana wallet activity | `HELIUS_API_KEY` | Wallets can be tracked; no transactions synced |
| Ethereum/Base wallet activity | `ALCHEMY_API_KEY` | Same as above |
| Higher GoPlus limits | `GOPLUS_APP_KEY`, `GOPLUS_APP_SECRET` | Keyless tier (~25 checks/min) |
| Cron-triggered jobs | `CRON_SECRET` | `/api/cron/tick` rejects all calls |

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (node-postgres / PGlite) with SQL migrations and row-level security · Zod · TradingView Lightweight Charts · Anthropic SDK · Stripe REST · Vitest · Playwright.
