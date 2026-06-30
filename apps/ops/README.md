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
pnpm --filter @echo/ops dev              # http://127.0.0.1:4100
```

Open the URL, paste your `OPS_ADMIN_TOKEN`, and the dashboard unlocks.

### Required env

| Var | Purpose |
|---|---|
| `OPS_ADMIN_TOKEN` | Bearer token gating every write + the dashboard. `openssl rand -hex 32`. |
| `DATABASE_URL` | Same Postgres the indexer uses. |
| `ARC_RPC_URL` | Arc testnet RPC. |
| `DEPLOYER_PRIVATE_KEY` | Owner key for on-chain writes. **Leave blank for read-only mode.** |

## Security model — read before deploying

- **The deployer key is the keys to the kingdom.** It owns the proxies. Keep it in `.env`
  (gitignored) and only on a host you control. With it blank, the dashboard runs read-only and the
  on-chain buttons disable themselves.
- **Bind to `127.0.0.1`** (the default). Do not expose this port publicly. If you must, put it
  behind a reverse proxy with TLS and keep the admin token secret — but for testnet, run it local.
- **The admin token never touches the chain** — it only gates the API. The private key never leaves
  the server; the browser only ever sends the bearer token.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness |
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
