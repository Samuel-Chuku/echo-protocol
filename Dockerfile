# Shared image for the Node services in this pnpm monorepo (indexer + ops).
# Built from the REPO ROOT so the workspace packages (@echo/sdk, @echo/types) resolve.
# Runs via tsx: @echo/sdk's package `exports` point at TypeScript source, so a plain
# `node dist/index.js` can't resolve it — tsx handles the TS workspace deps at runtime.
#
# Pick the app with a build arg:  --build-arg APP_DIR=apps/indexer  (or apps/ops)
FROM node:20-alpine

ARG APP_DIR
ENV APP_DIR=${APP_DIR}

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
# --prod=false: tsx is a devDependency and IS the runtime (it resolves the TS workspace deps),
# so we must install dev deps even though the image runs in production.
RUN pnpm install --frozen-lockfile --prod=false --filter "@echo/indexer..." --filter "@echo/ops..."

# 2) Source. node_modules / dist / .env etc. are excluded via .dockerignore, so the
#    installed dependency tree from the layer above is preserved.
COPY . .

# Runtime is production (Express optimizations) — set AFTER install so dev deps still landed.
ENV NODE_ENV=production

# Run the selected app with tsx. cd into the app so its relative paths (ops serves ./public,
# indexer reads ./ .env via the env_file) resolve as they do in dev.
CMD ["sh", "-c", "cd /app/${APP_DIR} && pnpm exec tsx src/index.ts"]
