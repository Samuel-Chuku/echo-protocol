# @echo/ops — Operator Dashboard

A small backend + single-page dashboard for running Echo Protocol on Arc testnet: monitor the
chain and indexer, flip off-chain feature flags, and execute owner-only on-chain controls.

It is intentionally **boring and local-first** — one Express process, one HTML page, one admin
token. No build step for the UI, no framework.

## What it does

- **Monitoring** — chain head, indexer cursor + lag, deployer USDC balance, dispute counts, and an
  owner-check that confirms the configured key actually owns each proxy (so writes will land).
- **On-chain controls** (owner-only) — seat/remove jurors (`setJuror`), Mode-A staking on/off
  (`setModeAStakeEnabled`), attester allow/deny (`setAttester`).
- **Feature flags** (off-chain) — `web.*` flags read by the frontend, `indexer.paused` read by the
  indexer loop. Stored in Postgres (`ops_feature_flags`), shared with the indexer's DB.
- **Indexer controls** — rewind the cursor to re-index from a block; pause/resume ingestion.

## Run

```bash
cp apps/ops/.env.example apps/ops/.env   # then edit it
pnpm install                             # from repo root (first time)
pnpm --filter @echo/ops totp:setup       # generates OPS_TOTP_SECRET + a QR to enroll
pnpm --filter @echo/ops dev              # http://127.0.0.1:4100
```

Open the URL and enter the current 6-digit code from your authenticator app. A valid code mints a
session that lasts `OPS_SESSION_TTL_MIN` minutes; after that it asks again.

### Required env

| Var | Purpose |
|---|---|
| `OPS_TOTP_SECRET` | Authenticator secret. Generate + enroll via `pnpm --filter @echo/ops totp:setup`. |
| `OPS_SESSION_TTL_MIN` | Session length in minutes after a successful code (default 60). |
| `DATABASE_URL` | Same Postgres the indexer uses. |
| `ARC_RPC_URL` | Arc testnet RPC. |
| `DEPLOYER_PRIVATE_KEY` | Owner key for on-chain writes. **Leave blank for read-only mode.** |

### How login works

1. `pnpm --filter @echo/ops totp:setup` prints a secret + `otpauth://` URI. Scan it into Google
   Authenticator / Authy / 1Password (or paste the secret as a "setup key").
2. The dashboard's sign-in asks for the rotating 6-digit code. `POST /api/login` verifies it
   (RFC 6238, ±1 step for clock skew, rate-limited per IP) and returns a session token.
3. Every admin request carries that session token as a bearer. No static password exists; a server
   restart invalidates sessions (you just enter a fresh code).

## Security model — read before deploying

- **The deployer key is the keys to the kingdom.** It owns the proxies. Keep it in `.env`
  (gitignored) and only on a host you control. With it blank, the dashboard runs read-only and the
  on-chain buttons disable themselves.
- **Bind to `127.0.0.1`** (the default). Do not expose this port publicly. If you must, put it
  behind a reverse proxy with TLS plus a network gate (Cloudflare Access / Tailscale) — TOTP guards
  the login, but the perimeter should not be the internet at large.
- **The authenticator code never touches the chain** — it only mints a session that gates the API.
  The private key never leaves the server; the browser only ever holds the session token.
- **`OPS_TOTP_SECRET` is a secret** — same handling as the deployer key: in `.env`, never committed.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness |
| POST | `/api/login` | — | `{ code }` → `{ token, expiresAt }` (rate-limited) |
| GET | `/api/flags/public` | — | `{ key: enabled }` map for the web app / indexer |
| GET | `/api/status` | admin | full monitoring snapshot |
| GET | `/api/flags` | admin | full flag rows |
| POST | `/api/flags/:key` | admin | `{ enabled }` — flip a flag |
| POST | `/api/indexer/reindex` | admin | `{ block }` — rewind cursor |
| POST | `/api/onchain/juror` | admin | `{ address, active }` |
| POST | `/api/onchain/mode-a-stake` | admin | `{ enabled }` |
| POST | `/api/onchain/attester` | admin | `{ address, allowed }` |

## Consuming flags from the web app

The frontend can poll `GET /api/flags/public` and react to `web.maintenance`,
`web.pauseMarketCreation`, `web.hideReject`. The indexer already honors `indexer.paused`.
