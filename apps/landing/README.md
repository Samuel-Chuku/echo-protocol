# @echo/landing

Marketing landing page for **echoprotocol.site**. Standalone Next.js app so it deploys to the root
domain independently of the app (which lives at `app.echoprotocol.site`).

- Palette, fonts, and the hero-wave / flow-graphic treatment are ported from `apps/web` so the two
  surfaces read as one family.
- No web3 dependencies — the landing never touches a wallet. Every "Go to App" CTA points at
  `NEXT_PUBLIC_APP_URL`.

## Local dev

```bash
pnpm install                 # from the repo root (workspaces)
pnpm --filter @echo/landing dev
# → http://localhost:3001   (port 3001 so it doesn't clash with apps/web on 3000)
```

Copy the env example and set the app URL for local:

```bash
cp apps/landing/.env.local.example apps/landing/.env.local
# NEXT_PUBLIC_APP_URL=http://localhost:3000   (points "Go to App" at the local app)
```

If `NEXT_PUBLIC_APP_URL` is unset it falls back to `http://localhost:3000` (see `src/lib/config.ts`).

## Deploy (Vercel)

1. Create a **new Vercel project** for this app, root directory `apps/landing`.
2. Domain: `echoprotocol.site` (+ `www` redirect).
3. Env var: `NEXT_PUBLIC_APP_URL=https://app.echoprotocol.site`.

See the repo root `DEPLOY.md` for the full domain/DNS map.
