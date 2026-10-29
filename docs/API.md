# API reference

All endpoints are same-origin JSON route handlers under `/api`. Authentication uses the `nx_session` httpOnly cookie set by login/signup. Mutating requests (`POST/PUT/PATCH/DELETE`) must carry a same-origin `Origin` header (browsers do this automatically) — cross-origin requests get `403`.

**Errors** are uniform: `{ "error": string, "code": string, "details"?: unknown }` with codes `bad_request`, `validation_error` (400), `unauthorized` (401), `upgrade_required` (402 — not in your plan), `forbidden` (403), `not_found` (404), `conflict` (409), `rate_limited` / `ai_quota` (429), `ai_unconfigured` / `billing_unconfigured` (503), `internal` (500).

## Auth

| Method & path | Body | Notes |
|---|---|---|
| `POST /api/auth/signup` | `{ email, password, acceptTerms: true }` | Creates account + session, sends verification email. Password ≥10 chars. Rate-limited per IP. |
| `POST /api/auth/login` | `{ email, password }` | Generic error on failure; timing-equalized; per-IP and per-email limits. |
| `POST /api/auth/logout` | – | Revokes the session. |
| `POST /api/auth/forgot-password` | `{ email }` | Always the same response (no account enumeration). |
| `POST /api/auth/reset-password` | `{ token, password }` | Single-use 30-min token; revokes all sessions. |
| `GET /api/auth/verify?token=` | – | Email verification link → redirects to `/verify-email`. |
| `POST /api/auth/resend-verification` | – | Signed-in, unverified users. |

## Market data

| Endpoint | Description |
|---|---|
| `GET /api/stream/signals` | Server-sent events: `signals` event with the count of new signals (checked every 15s). |
| `GET /api/tokens/search?q=` | Tracked tokens by symbol/name/address. Unknown contract addresses are fetched live from providers (rate-limited). |
| `GET /api/tokens/{id}/candles?tf=15m\|1h\|4h\|1d` | OHLCV from GeckoTerminal (`source`), falls back to SOLME snapshots (`source: "snapshots"`, `degraded`). Demo tokens return labelled synthetic candles. |
| `GET /api/health` | Public liveness/readiness: DB driver & latency, market-data age, configured integrations (booleans only). |

## Watchlists

| Endpoint | Body |
|---|---|
| `GET /api/watchlists` | – |
| `POST /api/watchlists` | `{ name }` (plan limit) |
| `PATCH /api/watchlists/{id}` · `DELETE /api/watchlists/{id}` | `{ name }` · – |
| `POST /api/watchlists/items` | `{ tokenId, watchlistId? }` (plan limit, chain must be in plan) |
| `PATCH /api/watchlists/items` | `{ itemId, isFavorite?, notes? }` |
| `DELETE /api/watchlists/items?tokenId=` or `?itemId=` | – |

## Alerts & notifications

| Endpoint | Body |
|---|---|
| `GET /api/alerts` · `POST /api/alerts` | `{ name, rule_type, chain?, token_id?, wallet_id?, params, channels: [in_app\|email\|telegram], cooldown_minutes }` |
| `PATCH /api/alerts/{id}` · `DELETE` | `{ is_active?, name?, channels?, cooldown_minutes? }` |
| `GET /api/notifications` · `POST /api/notifications` | – · `{ ids? }` marks read (all when omitted) |

Rule types and params: `price_above`/`price_below` `{ price }` (fires on crossing); `price_change` `{ window: m5\|h1\|h24, pct, direction: up\|down\|either }`; `volume_spike` `{ multiple }`; `liquidity_drop` `{ pct }` (vs ~1h ago); `signal_score` `{ min_score, signal_types? }`; `security_warning` `{ min_level: medium\|high\|critical }`; `wallet_activity` `{ directions? }`.

## Wallets

| Endpoint | Body |
|---|---|
| `GET /api/wallets` · `POST /api/wallets` | – · `{ chain, address, label? }` (Pro+, plan limit) |
| `PATCH /api/wallets/{id}` · `DELETE` | `{ custom_label?, alerts_enabled? }` |

## Billing

| Endpoint | Body |
|---|---|
| `POST /api/billing/crypto` | `{ planId: pro\|elite, interval: month\|year, currency: USDC\|SOL }` → a Solana Pay quote (amount, recipient, `solana:` URL, QR) valid 30 minutes. Requires verified email. |
| `GET /api/billing/crypto/:id` | The quote's status (`pending`, `confirmed`, `expired`); checks the chain for the payment. |
| `POST /api/billing/crypto/:id` | `{ signature }`: claim a payment sent without the reference key (e.g. typed by hand). The transaction is verified on-chain before anything unlocks. |

Billing is crypto-only and prepaid: nothing renews automatically. The worker job `billing.crypto` (every 15s) confirms open quotes and sends renewal reminders.

## Settings & support

| Endpoint | Body |
|---|---|
| `POST /api/settings` | `{ action: profile, … }`, `{ action: password, current, next }`, `{ action: revoke_session, sessionId }`, `{ action: revoke_others }`, `{ action: telegram_test }`, `{ action: delete_account, password, confirm: "DELETE" }` |
| `POST /api/support` | `{ email, subject, message }` (public, rate-limited, honeypot field `website`) |

## Admin (role `admin`; support tickets also `support`)

| Endpoint | Body |
|---|---|
| `PATCH /api/admin/users/{id}` | `{ action: role, role }`, `{ action: status, status }`, `{ action: verify_email }`, `{ action: revoke_sessions }`, `{ action: grant_plan, planId, days }` |
| `PUT /api/admin/plans/{id}` | Full plan object incl. `features` (validated) |
| `PUT /api/admin/settings/scoring` · `/ingestion` | Validated settings objects |
| `POST /api/admin/ingest` | Queue an ingestion cycle now |
| `POST /api/admin/wallets` · `DELETE ?id=` | Documented public wallet (`classification_source` required) |
| `PATCH /api/admin/support/{id}` | `{ status, admin_note }` |

All admin mutations are audited.

## Cron

`GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` runs one scheduler tick (enqueue due recurring jobs, process up to 20).
