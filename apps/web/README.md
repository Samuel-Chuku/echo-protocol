# Echo Console (`apps/web`)

A **functional reference console** for Echo Protocol — a click-through guide that wires every live
on-chain command to a button, organized by role. It is intentionally lean (not the polished product):
its job is to show the next frontend developer exactly how each contract call is made through the SDK.

## Run

```bash
pnpm install        # from the repo root — pulls @tanstack/react-query, links @echo/sdk
cd apps/web && pnpm dev   # http://localhost:3000
```

Click **Connect Wallet** (RainbowKit modal — Rabby/MetaMask/Coinbase/WalletConnect/Browser) on **Arc
Testnet** (chain 5042002). Register an identity and approve USDC in the top bar before funding markets
or posting dispute bonds. Copy `.env.local.example` → `.env.local` and set `NEXT_PUBLIC_WC_PROJECT_ID`
(free, from https://cloud.reown.com) to enable WalletConnect/mobile wallets.

### Wallets

- **RainbowKit** provides the single Connect button + all-wallets modal (`lib/wagmi.ts`,
  `lib/provider.tsx`). The SDK signs through the *active connector's* EIP-1193 provider (`lib/sdk.ts`),
  so every wallet type works — not just injected ones.
- **Circle Modular Wallet (passkey smart account)** is scaffolded in `lib/circle.ts` as a custom
  RainbowKit wallet. It stays hidden until you set the `NEXT_PUBLIC_CIRCLE_*` env vars, install
  `@circle-fin/modular-wallets-core`, confirm Circle supports Arc, and opt it into `lib/wagmi.ts`
  (instructions at the top of `lib/circle.ts`).

## Surfaces

| Route | Role | What it exercises |
|-------|------|-------------------|
| `/` | Activity | live MarketRegistry + DisputeResolver event feed (`getLogs`) |
| `/hire` | Requester | create market (Open/Reveal/DirectJob/Bounty), fund attribution, reveal + settle/flag stake, grade tiers, milestones, findings, close, ghost |
| `/apply` | Worker | browse markets, apply, submit milestone/finding, read receipts |
| `/attribution` | Introducer | propose / confirm / revoke Attribution Receipts + reads |
| `/disputes` | Jury / parties | open (finding or stake), counter, vote, resolve, claim, agent hint |

## How it's wired

- **All contract calls go through `@echo/sdk`** (`lib/sdk.ts` → `useEcho()`), per the project rule
  "use the SDK, don't write raw calls." Every new contract command has a typed SDK method.
- **Reads are direct (no indexer yet).** Where the guide eventually wants GraphQL, this reads the
  chain via the SDK's `publicClient`. Marked `// TODO: swap to indexer` where relevant.
- **`components/Command.tsx`** is the button primitive: runs an SDK call, shows pending state, and
  links the resulting tx to Arcscan.
- `lib/agent.tsx` stashes your ERC-8004 `agentId` (Arc has no address→agentId reverse lookup).

## Deferred (see `docs/guidelines/FRONTEND_GUIDE.md` for the full product spec)

shadcn/ui, urql + the GraphQL indexer, Dynamic/Circle SCA onboarding, Framer Motion polish, charts,
responsive/a11y passes, and tests. This console is the contract-interaction backbone to build that on.
