# Shared image for the Node services in this pnpm monorepo (indexer + ops).
# Built from the REPO ROOT so the workspace packages (@echo/sdk, @echo/types) resolve.
# Runs via tsx: @echo/sdk's package `exports` point at TypeScript source, so a plain
# `node dist/index.js` can't resolve it — tsx handles the TS workspace deps at runtime.
#
# Pick the app with a build arg:  --build-arg APP_DIR=apps/indexer  (or apps/ops)
FROM node:20-alpine

RUN corepack enable
WORKDIR /app

# Resilience against flaky registry connections during the install (retries with backoff).
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_factor=2
ENV npm_config_fetch_retry_mintimeout=10000
ENV npm_config_fetch_retry_maxtimeout=120000

# 1) Dependency layer — cached until any manifest or the lockfile changes.
#    Copy every workspace member's package.json so pnpm can build the graph, then install
#    only the two backend apps and their deps (skips the heavy web/next dependency tree).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/sdk/package.json      packages/sdk/
COPY packages/types/package.json    packages/types/
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json          apps/web/
COPY apps/indexer/package.json      apps/indexer/
COPY apps/ops/package.json          apps/ops/
# --prod: only runtime deps land in the image. `tsx` (the runtime — it resolves the TS workspace
# deps on the fly) is a PROD dep of both apps, so this keeps it while dropping the heavy build/test
# tooling (vitest→vite, drizzle-kit, typescript, @types) that never runs in production. That roughly
# halves the image — smaller pulls + far less disk pressure on the VPS.
#
# The BuildKit cache mount persists pnpm's content-addressable store ACROSS builds. Without it, any
# lockfile change re-downloads every package from scratch (~1000 pkgs, minutes on a VPS); with it,
# pnpm reuses already-fetched packages from /pnpm-store and downloads only what's new. --store-dir
# points pnpm at the mounted cache. (Requires BuildKit — docker compose uses it by default.)
# --network-concurrency / --child-concurrency are dialed DOWN so a small (1-2GB) VPS doesn't OOM
# (exit 137): fewer parallel tarball extractions + postinstall scripts = a much lower memory peak,
# and it's gentler on a flaky network (fewer simultaneous sockets → fewer EPIPE/timeout retries).
# The cost is a slower install, but a slow install that finishes beats a fast one the kernel kills.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --store-dir=/pnpm-store \
    --network-concurrency=4 --child-concurrency=1 \
    --filter "@echo/indexer..." --filter "@echo/ops..."

# 2) Source. node_modules / dist / .env etc. are excluded via .dockerignore, so the
#    installed dependency tree from the layer above is preserved.
COPY . .

# Runtime is production (Express optimizations) — set AFTER install so dev deps still landed.
ENV NODE_ENV=production

# ONE image serves BOTH backends. The app is chosen at RUNTIME via $APP_DIR (set per service in
# docker-compose), NOT baked at build time — so CI builds a single image instead of two
# near-identical ones (half the build work, one image to pull + store on the VPS). The image carries
# both apps' code + the shared node_modules, so either can run from it. Defaults to the indexer.
ENV APP_DIR=apps/indexer

# Run the selected app with tsx. cd into the app so its relative paths (ops serves ./public,
# indexer reads ./ .env via the env_file) resolve as they do in dev. $APP_DIR is read from the
# container env at start, so compose's per-service `environment: APP_DIR=…` picks the app.
CMD ["sh", "-c", "cd /app/${APP_DIR} && pnpm exec tsx src/index.ts"]
