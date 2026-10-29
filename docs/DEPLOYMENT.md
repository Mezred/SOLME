# Deployment & operations

## Recommended topology

| Component | Recommended | Notes |
|---|---|---|
| Web app | Vercel (or any Node 20.9+ host: Railway, Render, Fly.io, a VM) | `npm run build && npm start` |
| Database | Managed PostgreSQL 15+ (Neon, Supabase, RDS, Railway) | Must permit `CREATE ROLE` + `GRANT` (used for row-level security). Enable automated backups/PITR. |
| Background worker | A long-running process: `npm run worker` (Railway/Render/Fly worker) | **Required for the live feeds** (PumpPortal launches, Helius smart-wallet websocket): they hold open sockets, which Vercel Cron → `/api/cron/tick` cannot. Cron alone runs the scheduled jobs only. |
| Email | Resend | Verify your sending domain (SPF/DKIM). |
| Payments | Solana Pay (no processor) | A Solana wallet you control to receive USDC / SOL. |

PGlite (embedded DB) is for local development only; production refuses to start without `DATABASE_URL` (override with `ALLOW_PGLITE_IN_PRODUCTION=true` only on a single instance with a persistent disk).

## Moving off the embedded database (PGlite → Postgres)

PGlite can only be opened by one process, so with it the web app and the worker share one process (`WORKER_IN_PROCESS=true`, the default without `DATABASE_URL`). To run the worker on its own, or to go live:

1. Create the Postgres database (see the table above).
2. Stop `npm run dev` (it holds the PGlite files), then copy everything across:
   `npm run db:copy-to-postgres -- "postgres://user:pass@host:5432/nexalpha?sslmode=require"`
   It migrates the target, empties it, copies every table (users, alerts, Telegram links, dev history, wallet scores, snapshots…) and moves id counters past the copied rows. It refuses a target that already has users unless you add `--force`. Your PGlite files are only read, never changed.
3. In `.env.local` (or the host's secrets) set `DATABASE_URL` to the new database and `WORKER_IN_PROCESS=false`.
4. Run the web app (`npm run dev` / `npm start`) and the worker (`npm run worker`) as two processes. Restarting the web app no longer interrupts alerts or the live feeds.

## Monitoring the live feeds

The worker checks the launch feed and the smart-wallet feed every minute. `GET /api/health` reports `feeds.status` (`ok` / `down`) and when it was last checked; admins with Telegram connected get a message when a feed goes down and when it is back (with the gap length). The last 20 gaps are kept in `app_settings` (`feed_health`): launches inside a gap are missing from dev scores.

## Step by step

1. **Database**: create a Postgres database and set `DATABASE_URL` (include `sslmode=require` for hosted providers). Run `npm run db:migrate` (or let the first request migrate). Confirm `schema_migrations` lists `0001_init`, `0002_rls`, `0003_default_config`.
2. **Environment**: set variables from `.env.example` in your host's secret manager. Required: `APP_URL`, `DATABASE_URL`, `CRON_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`. Set `WORKER_IN_PROCESS=false` on serverless hosts.
3. **Deploy the web app**: Vercel → import the repo, framework "Next.js", build command `npm run build`. `vercel.json` registers a cron for `/api/cron/tick` every 2 minutes (Vercel sends `CRON_SECRET` automatically; per-minute crons need a paid Vercel plan). The tick route has `maxDuration = 300`.
4. **Deploy the worker** (preferred over cron): same repo and env vars, start command `npm run worker`. Multiple workers are safe (SKIP LOCKED + dedup keys). If you run the worker, you may remove the Vercel cron.
5. **Admin account**: sign up with `BOOTSTRAP_ADMIN_EMAIL`; verify the email.
6. **Payments**: set `SOLANA_PAY_RECIPIENT` to a Solana wallet you control (public address only) and `HELIUS_API_KEY`. Users pay USDC or SOL via Solana Pay; the worker confirms each payment on-chain (job `billing.crypto`, every 15s) and extends their prepaid plan. Make sure the wallet has a USDC token account (receive any USDC once) so USDC payments are not rejected. Test with a small real payment on a cheap plan before going live.
7. **Email**: set `RESEND_API_KEY` and `EMAIL_FROM` on a verified domain.
8. **Optional**: `TELEGRAM_BOT_TOKEN`, `HELIUS_API_KEY` (strongly recommended: launches, holders, sell simulation, wallets), `GOPLUS_APP_KEY/SECRET`.
9. **Domain & HTTPS**: add your domain in the host; HTTPS is automatic on Vercel/Render/Railway. Session cookies are `Secure` in production.

## Production smoke test

```bash
curl -s https://<domain>/api/health            # status ok, db driver pg, marketDataAgeSeconds < 600 after first cycle
E2E_BASE_URL=https://<staging-domain> npm run test:e2e   # run against staging, not production (it creates accounts)
```

Then: sign up → verify email → open Early Coins → add a watchlist token → create an alert → buy the cheapest plan with a small real USDC payment → confirm the plan flips only after the payment is confirmed on-chain → confirm the "Paid until" date.

## Monitoring

- `GET /api/health` for uptime checks (alert if non-200 or `marketDataAgeSeconds` > 900).
- Admin → API providers (status, latency, last error), Errors & jobs, Alert delivery, AI usage & cost, Security & audit log.
- Logs are JSON on stdout (ship to your log drain); warn/error are also persisted to `app_logs` (30-day retention).
- `instrumentation.ts#onRequestError` logs unhandled server errors with their digest.

## Backups & data retention

Use your provider's automated backups/PITR. The worker prunes market snapshots after `snapshot_retention_days` (Admin → Data refresh), finished jobs after 2 days, logs after 30 days, expired sessions after 7 days.

## Scaling notes

- Web instances are stateless; rate limits and the job queue live in Postgres.
- Provider calls are centralized in the worker; adding users does not add provider traffic (except on-demand address lookups, AI and candle requests, which are cached and rate-limited).
- For large datasets add a "latest snapshot per token" materialized table if screener queries slow down (currently a LATERAL join on an indexed column).

## Launch checklist (non-technical)

- Have counsel review Terms, Privacy Policy and Risk Disclaimer for each launch jurisdiction (financial-promotion rules, consumer law, GDPR/CCPA, tax/VAT on subscriptions paid in crypto).
- Confirm provider terms allow commercial redistribution of their data at your scale (DexScreener, GeckoTerminal/CoinGecko, GoPlus) or upgrade to paid tiers.
- Decide refund policy and support SLAs.
