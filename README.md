# SOLME

Solana memecoin intelligence that a beginner can read in seconds and an experienced trader can verify.

SOLME is four features plus Alerts:

- **Early Coins** (home): fresh coins where real activity is starting, and why each one is there.
- **Coin Check**: a coin's risk in plain words (Low / Moderate / High / Critical), with the evidence behind it.
- **Proven Devs**: who launched a coin, and what their earlier coins did.
- **Smart Wallets**: wallets with a strong record, and what copying them would actually have returned.
- **Alerts**: one place for every alert, on Telegram, by email or in-app.

Subscriptions are paid with USDC or SOL through Solana Pay (prepaid, no card on file), and an admin panel runs the platform.

> Crypto assets are highly volatile and can lose all value. SOLME is a research tool: it is not financial advice, never calls a coin "safe", and does not guarantee any outcome.

## Contents

- [The product](#the-product)
- [Early Coins](#early-coins)
- [Coin Check](#coin-check)
- [Proven Devs](#proven-devs)
- [Smart Wallets](#smart-wallets)
- [Followed wallets and Watchlist](#followed-wallets-and-watchlist)
- [Alerts](#alerts)
- [Plans and billing](#plans-and-billing)
- [Data sources](#data-sources)
- [Quick start (local)](#quick-start-local)
- [Configuration](#configuration)
- [Background jobs](#background-jobs)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Security](#security)
- [Testing](#testing)
- [Deploying to production](#deploying-to-production)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)
- [Tech stack](#tech-stack)

## The product

| Where | What it is |
|---|---|
| `/app` | **Early Coins**, the home page |
| `/app/check` | **Coin Check**: paste any Solana contract |
| `/app/token/solana/<id>` | A coin's page with its full Coin Check |
| `/app/smart-dev` | **Proven Devs**: live launches and the developer leaderboard |
| `/app/smart-dev/<creator>` | A developer's profile |
| `/app/smart-money` | **Smart Wallets**: the list and their recent buys |
| `/app/wallets/<id>` | A wallet's profile |
| `/app/alerts` | **Alerts**: presets grouped by feature, custom rules, history |
| `/app/watchlist`, `/app/wallets` | Watchlist, Followed wallets |
| `/app/billing`, `/app/settings` | Billing, Settings (profile, Telegram, quiet hours, sessions, account deletion) |
| `/admin` | Admin panel (admins only) |

**Layout**
- Desktop: a left sidebar with the four features and Alerts, with Watchlist, Followed wallets, Billing and Settings underneath.
- Phone: a bottom tab bar.

**Colours**
- Purple is the brand accent.
- Status always pairs colour with an icon or label: green ✓ positive, amber ⚠ caution, red ✗ critical.

`/app/screener` redirects to Early Coins: the Screener is no longer part of the product.

## Early Coins

The home page lists fresh Solana coins where real activity is starting.

**A coin is included only when it is:**
- under 3 days old;
- backed by at least $5k of liquidity;
- showing market data under 30 minutes old.

**Each coin lands in one class.**

| Class | When |
|---|---|
| **Early Activity** | At least one activity signal (below). |
| **Building Momentum** | 3+ signals, including at least one activity signal **and** smart wallets buying or a proven dev. |
| **High Risk** | Any critical flag (below). It overrides the other two. |

**Signals and their weights**

Activity is always measured against the coin's own average hour over the last 6 hours.

| Signal | Type | Condition | Weight |
|---|---|---|---|
| Volume | Activity | 1h volume ≥ 1.8× its 6h pace and ≥ $5k | 2 |
| Transactions | Activity | 1h transactions ≥ 1.8× their 6h pace and ≥ 60 | 1.5 |
| Buy transactions | Activity | Buys ≥ 1.5× their pace, ≥ 55% of trades, ≥ 50 trades | 1.5 |
| Unique buyers | Activity | 25+ different wallets bought (over $2 each) within the last 90 minutes of real pool trades | 1.5 |
| Smart wallets | Quality | A smart wallet (score 60+, not a bot) bought in the last 24h | 2.5 (3 if 2+ wallets) |
| Proven dev | Quality | Dev score 60+ | 2 |
| Pool depth | Quality | Liquidity ≥ $30k and market cap ≤ 10× liquidity | 1 |
| Trend | Price | +5% to +150% in 1h, and not spiking in the last 5 minutes | 0.5 |

Price is a small signal and never ranks a coin on its own.

**Unique buyers.** Market data providers only report buy *transactions*, which bots inflate. For the top coins, SOLME reads the latest ~100 trades on the coin's pool every few minutes and counts the different wallets that bought. Dust-only buyers (under $2, typical of volume bots) don't count. When a busy sample comes from 5 wallets or fewer, the transaction signals are dropped and the card says "Only N wallets bought across the last M trades". A Coin Check updates the count too.

**Critical flags (High Risk)**
- The contract check is high or critical risk.
- The coin failed the launch scam check.
- Liquidity fell 40% from its 2-hour peak.
- The price fell 40%+ in 1h.
- Market cap is 40× liquidity or more.
- The dev sold 5%+ of supply.

**Caution flags**
- The contract hasn't been checked yet.
- Market cap is 20–40× liquidity.
- Only a handful of wallets make the activity (see unique buyers).

**Each card shows:**
- the stats and the signals that put the coin there;
- its flags and contract-scan status ("no critical issue", never "safe");
- when it was updated, and what couldn't be measured.

A link opens the full Coin Check. Free shows 5 coins; Pro and Elite show all.

## Coin Check

Paste any Solana contract (pump.fun, LetsBonk or any Solana DEX) on `/app/check`, open a coin's page, or send the contract to the Telegram bot.

**The result**

1. **Overall risk: Low, Moderate, High or Critical.**

   | Level | When |
   |---|---|
   | Critical | Any failure in selling, transfers, the contract, liquidity, the pool or the exit. |
   | High | Any other failure, 3+ warnings, or an active dump. |
   | Moderate | Warnings or missing checks. |
   | Low | Nothing found. Low is never presented as safe. |

2. **The top 3 findings** that matter most.
3. **Five plain questions**, each expandable with its checks:
   - **Can I sell it?**
     - A real sell of about $500 is simulated on-chain through Jupiter (never sent) from a real holder's wallet.
     - It reports the proceeds against the quote, any hidden tax, and blocked or frozen transfers.
     - A route problem specific to one holder retries with another holder.
     - A slippage failure is retried with a fresh quote at 30% before it counts as a trap.
   - **Is the liquidity real?**
     - Pool depth in real quote assets (SOL, USDC, USDT), how much a $500 sell moves the price, and market cap against liquidity.
     - Liquidity under $5k fails; under $15k is thin.
     - Exit impact warns at 6% and fails at 15%. Market cap above 25× liquidity warns.
   - **Who controls it?**
     - Mint and freeze authority, transfer hooks and fees, and LP status.
     - Top holder concentration. Pool vaults are excluded so they never count as holders.
   - **Are insiders set to dump?**
     - The top 15 holders are traced to their funders. Wallets funded together are grouped; exchanges and known hubs are ignored.
     - Fresh wallets, the share held by the bundle, snipers, the developer's record, and whether the dev has sold.
     - A dev sale of 3%+ in the first 2 hours fails; smaller sales warn.
   - **Is the trading genuine?**
     - The last 100 trades: volume bots (dust trades under $2), wallets trading in circles, and the buy/sell balance.
4. **SOLME's read.** Whether a trade looks reasonable now, wait, or avoid, plus timing (for example "dumping"), the reasons to buy, what's missing, and what to watch if you buy.

**Every finding is labelled:**
- **confirmed**: read on-chain or simulated;
- **inferred**: deduced from patterns (insiders, trading, dev sales);
- **not available**: with the reason.

Each shows when it was read.

**Evidence links.** Under each finding, links open the evidence on Solscan:
- the token (authorities, transfers) and its holders;
- the pool and its trades (liquidity, exit cost, trading patterns);
- the dev wallet and each recorded dev sale transaction;
- the funder shared by a group of top holders;
- the developer's SOLME profile.

The sell test is a simulation that is never sent, so it has no transaction to link, and the card says so.

**Limits and caching**
- Investigations are cached for 5 minutes.
- Each user can run 30 every 10 minutes, and the platform 150 an hour (this protects the Helius budget).

## Proven Devs

Live pump.fun and LetsBonk launches (via the PumpPortal stream), a leaderboard, and a profile for each developer.

**Dev score (0–100)**
- **80%** comes from a recency-weighted value per launch. A launch's weight halves every 30 days.

  | Launch outcome | Value |
  |---|---|
  | Didn't migrate | 0 |
  | Dev dumped | 0.25 |
  | Migrated then collapsed | 0.4 |
  | Migrated, not measured yet | 0.75 |
  | Migrated and held at least half its market cap after an hour | 1 |

- **20%** comes from the best post-migration market cap: $30k scores 0 and about $1M scores full marks.
- Small samples are pulled toward the launchpad base rate (about 2% of launches migrate).
- A dev with no launch that migrated and held is capped at 40. So **proven (60+, with 2+ launches)** always means at least one real success.

**Reputation labels**

| Label | Meaning |
|---|---|
| **Proven** | Score 60+ with enough recent history to judge. |
| **Promising** | A good record so far, but too few recent launches to be confident. |
| **Mixed** | Some coins migrated, but most didn't or didn't hold. |
| **Unproven** | A few launches and no migration yet. |
| **Serial launcher** | 10+ launches and none migrated. |
| **New** | First recorded launch. |

SOLME never labels a developer a scammer.

**A developer's profile shows:**
- every launch and its outcome;
- sales of their own coins that SOLME observed (5%+ of supply counts as a dump);
- wallets linked through a shared funder.

A shared funder is shown as *inferred*, never as proof of the same owner. A funder that has funded 20+ creators is treated as a hub, not a link.

Free and Pro see a preview of the leaderboard; the live list of proven-dev launches on this page is Elite. The alert for a proven-dev launch works on every plan.

## Smart Wallets

**How wallets are found**
- Every 30 minutes, SOLME looks at the early buyers of coins that pumped. A buy counts as early if it came within an hour of launch.
- Each candidate is scored on 30 days of its *other* trades. The coins it was found on are excluded, so a wallet isn't rewarded for the pump that got it noticed.

**Wallet score v2 (0–100)**
- **Components**
  - 35% win rate, pulled toward 50% for small samples;
  - 30% profit in SOL;
  - 20% early-hit rate (positions that reached 2×);
  - 15% profit factor.
- **What doesn't count**
  - Positions under 0.1 SOL.
  - Wallets with fewer than 5 decided positions get no score at all.
- **Holdout test**
  - The last 10 days are kept out of the score and used to check it.
  - A wallet whose recent trades lose ("faded") keeps 70% of its score.
- **Penalties**
  - Bot-like wallets are scored at 60%.
  - Insiders are capped at 30, below every list and alert.
- **Watching**
  - Wallets scoring 60+ are watched for new buys.

**A wallet's profile shows, in plain words:**
- how it trades (style, typical size, how long it holds);
- its own 30-day results;
- what copying it would have returned after about 3% modeled fees and slippage, shown separately from its own results;
- risk indicators, when it was last active, and how far the numbers can be trusted.

**Holds now.** The profile reads the wallet's balances live from the chain: SOL, and every token it holds. Tokens are valued at SOLME's latest prices, and USDC/USDT at $1. Tokens SOLME has no price for are counted, not listed. This is cached for a minute.

Smart Wallets is an Elite feature.

## Followed wallets and Watchlist

**Followed wallets (Pro: 5, Elite: 100)**
- Follow any public wallet, whatever its score, to get every buy and sell it makes in any coin within seconds. Token-to-token swaps count as a sell plus a buy.
- Each alert shows the SOL spent, the price, the market cap, and the change since the wallet bought.
- Alerts can be filtered by direction, a minimum size in SOL, or "only buys that pass the scam check".

**Watchlist**
- Coins you keep an eye on.
- Pair it with the *watchlist risk* alert to hear when one turns risky.

## Alerts

Alerts live in one place, grouped by feature. One-click presets cover the common cases:

| Feature | Preset | Plan |
|---|---|---|
| Early Coins | A coin starts Building Momentum | Pro |
| Early Coins | Any coin enters Early Coins with its contract checked OK | Free |
| Coin Check | A coin on your watchlist turns risky (its full Coin Check rises to High or Critical, a high/critical contract result, or liquidity down 30%+ in about an hour) | Free |
| Proven Devs | A proven dev launches a new coin | Free |
| Smart Wallets | A smart wallet buys a coin that passes the scam check | Elite |
| Smart Wallets | 3+ smart wallets buy the same coin within 10 minutes | Elite |
| Smart Wallets | A wallet you follow buys a coin that passes the scam check | Pro |
| Smart Wallets | Every buy and sell by wallets you follow | Pro |

**Early Coins and watchlist risk alerts can be tuned** in the New alert form:
- Early Coins: the class (Building Momentum, or Early Activity or better), minimum liquidity, minimum number of smart wallets that bought, contract checked OK only, and **at most N alerts per hour** for that rule. Coins over the limit alert later if they are still in the feed.
- Watchlist risk: the liquidity drop that counts. SOLME also **re-runs the full Coin Check** on watched coins about every 30 minutes (sell test, holders, insiders, trading). It alerts once when the overall risk rises to High or Critical, with the findings that changed it.

**Custom rules** are also available: price above/below, price move %, volume spike, liquidity drop, security warning, bonding curve progress, and saved screener templates (existing rules keep working).

**Delivery**
- **Once per event.** Every event has a dedup key, so it arrives once.
- **Why it fired.** Every alert says what triggered it.
- **No backlog.** When you switch on an Early Coins alert, the coins already in the feed are recorded silently, so you only hear about new ones. Each run sends at most 5 new coins (best ranked first), within the rule's hourly limit if one is set.
- **Channels:** in-app (all plans), plus Telegram and email (Pro and Elite).
- **Controls:** Telegram messages have mute buttons. Quiet hours collect alerts into one summary afterwards.

**Telegram bot**
- Link it from Settings.
- Send it any Solana contract to get a Coin Check card: the risk level, the five questions, the reasons to buy and SOLME's read.

## Plans and billing

| | Free | Pro | Elite |
|---|---|---|---|
| Price | $0 | $29 / month or $290 / year | $79 / month or $790 / year |
| Coin Check | Any coin | Any coin | Any coin |
| Early Coins | 5 coins | All | All |
| Alerts | 3, in-app | 25, Telegram & email | 100, Telegram & email |
| Followed wallets | — | 5 | 100 |
| Proven Devs | Leaderboard preview | Leaderboard preview | Full leaderboard + live launches |
| Smart Wallets (list, profiles, alerts) | — | — | ✓ |
| Priority support | — | — | ✓ |

Prices and every limit live in the database. Admins edit them in **Admin → Pricing**, and the server enforces them on the next request.

**Billing is crypto-only (Solana Pay)**

1. **Quote.** On Billing, pick a plan, a period (1 month = 30 days, 1 year = 365 days) and USDC or SOL. SOLME creates a quote valid for 30 minutes. It has a unique reference key and amount, and shows a QR code and a `solana:` link for any wallet. SOL is priced at the current rate.
2. **Pay.** The payment goes straight to the wallet in `SOLANA_PAY_RECIPIENT`.
3. **Confirmation.**
   - The worker checks open quotes every 15 seconds. It reads the transaction on-chain and checks the amount that actually reached the recipient.
   - A payment sent without the reference (typed by hand) can be claimed by pasting its signature, and is verified the same way.
   - Late payments, up to 24 hours after the quote, are still matched.
4. **Activation.**
   - The plan activates only after confirmation.
   - Renewing early adds the time on top.
   - Upgrading converts your remaining days into days on the new plan.
5. **Renewal.** Nothing renews automatically. You get a reminder by email and Telegram 3 days before a plan ends; if you don't pay again, you return to Free.

Payments are final once confirmed on-chain. Admins can also grant plans manually; these grants are audited and are not payments.

Stripe card billing was removed (migration `0033`). Past card subscriptions are kept as history and no longer grant access.

## Data sources

| Provider | Used for | Key |
|---|---|---|
| Helius (RPC + websockets) | Holders, funders, transaction history, the sell simulation, pool trades (unique buyers, trading patterns), smart and followed wallets, live wallet balances, launch data, payment confirmation | `HELIUS_API_KEY` |
| Jupiter (`lite-api.jup.ag`) | Sell quotes and swap transactions for the simulation | none |
| PumpPortal stream | Live pump.fun and LetsBonk launches and migrations | none |
| DexScreener | Pairs, prices, volume, transactions, liquidity, pools | none |
| GeckoTerminal | Candles, trending and new pools | none |
| GoPlus | Contract security checks | optional key for higher limits |
| Telegram Bot API | Alerts and the Coin Check bot | `TELEGRAM_BOT_TOKEN` |
| Resend | Email | `RESEND_API_KEY` |

## Quick start (local)

Requirements: Node.js 20.9+ (tested on 24), npm.

```bash
npm install
npx playwright install chromium     # only needed for e2e tests
cp .env.example .env.local          # then add the keys you have (see Configuration)
npm run dev                         # http://localhost:3000
```

With no keys at all you still get:

- An embedded PostgreSQL (PGlite) in `.data/pglite` (move it with `PGLITE_DIR`), migrated automatically on start.
- An in-process background worker that ingests live market data from DexScreener, GeckoTerminal and GoPlus (all keyless) every ~2 minutes.
- Emails printed to the server console. In development, verification and reset links are also shown on screen.

Two keys unlock the rest:
- **`HELIUS_API_KEY`** powers the features traders use every day: launches, holder analysis, the sell simulation, smart wallets and followed wallets. It is also needed for crypto payments.
- **`TELEGRAM_BOT_TOKEN`** turns on Telegram alerts and the bot.

**Accounts.** Sign up at `/signup`. To make yourself an admin, set `BOOTSTRAP_ADMIN_EMAIL` before signing up, or use the seed accounts:

```bash
# PGlite allows one process per data dir: stop `npm run dev` first.
npm run db:seed
```

**Seed accounts**
- `admin@`, `elite@`, `pro@` and `free@nexalpha.local`.
- Password: `nexalpha-demo-2026` (override with `SEED_PASSWORD`).
- Paid plans on seed accounts are audited admin grants, not payments.

### Demo mode

`DEMO_MODE=true` replaces live ingestion with a synthetic dataset.
- Every demo row is flagged `is_demo`, and token names are prefixed `[DEMO]`.
- The dashboard shows a persistent banner.
- Queries never mix demo and live rows.

## Configuration

All keys go in `.env.local`, which git ignores. **Never commit secrets.** For payments you only ever enter a **public** wallet address, never a private key or seed phrase. See [.env.example](.env.example) for every variable.

| Feature | Variables | Without them |
|---|---|---|
| Production database | `DATABASE_URL` (PostgreSQL 15+, must allow `CREATE ROLE`), optional `DATABASE_POOL_MAX` | Embedded PGlite (dev only; production refuses to start) |
| Public URL | `APP_URL` | `http://localhost:3000` |
| On-chain data | `HELIUS_API_KEY` | Market data and contract checks only |
| Subscriptions (USDC / SOL) | `SOLANA_PAY_RECIPIENT` (your wallet's public address) + `HELIUS_API_KEY` | Paid plans cannot be bought; admins can grant plans |
| Telegram alerts and bot | `TELEGRAM_BOT_TOKEN` | Telegram unavailable |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Emails logged, not sent |
| Higher GoPlus limits | `GOPLUS_APP_KEY`, `GOPLUS_APP_SECRET` | Keyless tier (~25 checks/min) |
| GMGN referral on "Trade on GMGN" buttons | `GMGN_REFERRAL_CODE` | Plain links |
| Cron-triggered jobs | `CRON_SECRET` | `/api/cron/tick` rejects all calls |
| Worker placement | `WORKER_IN_PROCESS` | On by default with PGlite; set `false` on serverless hosts |
| First admin | `BOOTSTRAP_ADMIN_EMAIL` | Promote admins from the database |
| Sessions | `SESSION_DAYS` | 30 days |
| Another Jupiter endpoint | `JUPITER_API_BASE` | Free `lite-api.jup.ag` |
| Synthetic data | `DEMO_MODE` | Live data |

**For the payment wallet**, make sure it has a USDC token account (receive any USDC once), so USDC payments aren't rejected.

## Background jobs

**How jobs run**
- Jobs run from a Postgres-backed queue (`FOR UPDATE SKIP LOCKED`). Dedup keys make scheduling idempotent, so several workers are safe.
- The worker runs inside `npm run dev`, as `npm run worker` in production, or via `/api/cron/tick`.

| Job | Every | What it does |
|---|---|---|
| `ingest.cycle` | ~2 min (admin setting) | Market data, security checks, snapshots, then the regular alerts (Early Coins, watchlist risk, price and liquidity rules) |
| `alerts.fast` | 15 s | Time-critical alerts: followed and smart wallet trades, group buys, proven-dev launches, curve progress |
| `alerts.deliver` | 30 s | Sends queued alerts to Telegram and email |
| `launchpad.checks.fast` / `launchpad.checks` | 15 s / 3 min | Launch scam checks on new coins |
| `launchpad.curves` | 30 s | Bonding curve progress |
| `launchpad.markets`, `launchpad.backfill` | 10 min | Migration outcomes, dev history |
| `telegram.poll` | 15 s | The Telegram bot (linking, Coin Check, mute buttons) |
| `billing.crypto` | 15 s | Confirms crypto payments; sends renewal reminders |
| `early.buyers` | 5 min | Unique buyers for the top Early Coins (up to 8 coins a run, 60 an hour) |
| `watchlist.recheck` | 10 min | Full Coin Check on watched coins with a watchlist risk alert (4 a run, each at most every 30 min) |
| `smartmoney.watch` | 90 s | New buys by watched smart wallets |
| `wallets.sync` | 10 min | Followed wallets' history |
| `wallets.score` | 15 min | Re-scores wallets |
| `smartmoney.discover`, `smartmoney.copystats` | 30 min | Finds new smart wallets; copy-trade statistics |
| `health.feeds` | 1 min | Live feed health |
| `maintenance.prune` | 1 h | Removes old data |

Live websockets also run alongside the jobs: the PumpPortal launch stream and the Helius wallet stream.

After changing code under `src/lib` that the worker runs (alerts, wallets, launches, billing), restart `npm run dev`. The in-process worker doesn't hot-reload.

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

## Project layout

| Path | Contents |
|---|---|
| `src/app/(marketing)` | Public site: home, features, pricing, how it works, FAQ, methodology, legal |
| `src/app/app` | The product (see [The product](#the-product)) |
| `src/app/admin` | Admin panel: overview, users, plans and prices, subscriptions and payments, providers, ingestion, scoring, wallets, alerts, logs, security, support |
| `src/app/api` | JSON API (auth, alerts, billing, settings, tokens, wallets, watchlists, admin, cron, health) |
| `src/components` | UI: `app/` (product), `admin/`, `marketing/`, shared `ui.tsx` |
| `src/lib/early` | Early Coins signals and classification (pure), the shared feed, the unique-buyer sampler |
| `src/lib/decision` | The Coin Check verdict (pure rules), the evidence it reads, explorer links per finding |
| `src/lib/tokens` | Holder analysis and the investigation (sell simulation, connected holders, pool depth, trading patterns), pool addresses |
| `src/lib/devs` | Developer profiles: reputation, launch outcomes, linked wallets |
| `src/lib/launchpad` | pump.fun / LetsBonk stream, dev scores, launch checks |
| `src/lib/wallets` | Smart-wallet discovery, scoring, live feed, profiles, live holdings, copy stats |
| `src/lib/alerts` | Alert rules, presets, engine, watchlist re-checks, Telegram formatting and bot |
| `src/lib/billing` | Plans, entitlements, crypto payments (Solana Pay), admin grants |
| `src/lib/providers` | DexScreener, GeckoTerminal, GoPlus, Helius, Jupiter clients, with rate limits and caching |
| `src/lib/jobs` | Queue, scheduler, feed health |
| `src/lib/db` | Query layer, PGlite/Postgres drivers, embedded migrations |
| `db/migrations` | SQL migrations `0001`–`0034` (embedded at build time) |
| `tests/unit`, `tests/e2e` | Vitest and Playwright suites |
| `docs/` | Architecture, API, deployment, limitations and costs |

## Security

- **Paid access**
  - Decided on the server only, from verified on-chain payments or audited admin grants. Nothing the browser sends can unlock a plan.
  - Every gated page and route checks the plan.
- **Sessions:** passwords hashed with scrypt; random session tokens stored hashed; httpOnly SameSite cookies.
- **Requests:** cross-origin mutations are rejected (CSRF), and inputs are validated with Zod.
- **Database:** row-level security, with user queries running as the `nexalpha_app` role.
- **Abuse protection:** rate limits on sign-in, search, Coin Check, checkout and account actions.
- **Audit log:** admin actions, plan grants and account deletions are audited.
- **Secrets and wallets:**
  - Secrets stay in environment variables, and `/api/health` reports features without exposing keys.
  - SOLME is read-only research software: it never asks for, holds or uses private keys, and never custodies funds.

## Testing

```bash
npm test             # unit + integration (in-memory Postgres per file)
npm run test:e2e     # Playwright on desktop and phone viewports
npm run lint && npm run typecheck && npm run build
```

**Unit and integration tests cover:**
- Early Coins classification, including unique buyers;
- the Coin Check verdict and investigation, and its evidence links;
- the Telegram cards;
- the alert engine (Early Coins limits, the watchlist risk re-check);
- wallet scoring and profiles;
- developer reputation;
- crypto payment verification;
- entitlements and admin grants.

**End-to-end tests cover:**
- accessibility: axe-core checks the main public and product pages (and a coin page) for serious WCAG 2.1 AA problems;
- sign-up and sign-in, and authorization;
- the sidebar and phone tab bar;
- Alerts, Proven Devs and watchlists;
- billing guards (no plan without an on-chain payment; the card routes are gone);
- phone layouts.

## Deploying to production

The full checklist is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

1. Create PostgreSQL 15+, set `DATABASE_URL`, and run `npm run db:migrate`.
2. Set the environment variables (at least `APP_URL`, `DATABASE_URL`, `CRON_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `HELIUS_API_KEY`, `SOLANA_PAY_RECIPIENT`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`).
3. Deploy the web app (`npm run build`, `npm start`; Vercel works with `vercel.json`).
4. Run the worker (`npm run worker`), or rely on the cron tick.
5. Sign up with the bootstrap admin email, set prices in Admin → Pricing, and make one small real USDC payment to check the flow end to end.

## Known limitations

- **Early Coins**
  - Unique buyers come from a sample of the latest ~100 pool trades, and only for the top coins (Helius budget). Other coins fall back to buy transactions, and the card says the count is missing.
  - Cards show the contract scan; the full Coin Check runs when you open a coin.
- **Coin Check:** the list of exchange and hub wallets used to ignore shared funders is best-effort.
- **Smart Wallets:** "Holds now" values only tokens SOLME has a market price for.
- **Alerts:** watched coins are fully re-checked about every 30 minutes, 4 per run, so a large set of watched coins takes longer to cycle through.
- **Accessibility:** automated checks (axe-core) pass on the main pages; a manual screen-reader pass hasn't been done.
- **Helius budget:** on-chain features depend on Helius and are budgeted to protect its credits.
- **Payments:** final once confirmed. There are no refunds through a processor.
- **Legal:** Terms, Privacy and Risk pages need review by counsel for each market.

More in [docs/LIMITATIONS_AND_COSTS.md](docs/LIMITATIONS_AND_COSTS.md).

## Documentation

- [Architecture & data model](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Deployment & operations](docs/DEPLOYMENT.md), including crypto payment setup
- [Limitations & operating costs](docs/LIMITATIONS_AND_COSTS.md)
- Methodology: rendered live at `/methodology`

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (node-postgres / PGlite) with SQL migrations and row-level security · Zod · Helius RPC & websockets · Jupiter · PumpPortal · DexScreener · GeckoTerminal · GoPlus · Solana Pay · Telegram Bot API · Resend · Vitest · Playwright.
