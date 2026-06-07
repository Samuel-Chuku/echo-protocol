# Frontend Guide — `apps/web`

## Your Surface Area

You own everything in `apps/web/src/`. The frontend is **5 distinct product surfaces**:

1. `echo.xyz` — Landing page + live activity ticker
2. `echo.xyz/apply` — Participant app (browse, apply, earn, withdraw)
3. `echo.xyz/hire` — Requester app (create, grade, track)
4. `echo.xyz/u/<handle>` — Public reputation profile
5. `echo.xyz/grade` — Grader sub-view (inside requester)

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS 3.4 |
| Components | shadcn/ui |
| State | React Server Components + SWR (client cache) |
| Blockchain | viem 2.x + wagmi 2.x |
| Wallet | Dynamic / Circle SCA (account abstraction) |
| GraphQL | urql |
| Animation | Framer Motion |
| Icons | Lucide React |
| Charts | Recharts |

---

## File Map — Where Everything Lives

```
apps/web/src/
├── app/                          # Next.js App Router (pages)
│   ├── layout.tsx               # Root layout: providers (wagmi, urql, theme)
│   ├── page.tsx                 # Landing page (`echo.xyz`)
│   ├── globals.css              # Tailwind + custom styles
│   │
│   ├── apply/                   # PARTICIPANT APP
│   │   ├── layout.tsx           # Participant nav, wallet widget
│   │   ├── page.tsx             # Dashboard (markets, earnings, rep)
│   │   ├── markets/
│   │   │   ├── page.tsx         # Browse all markets
│   │   │   ├── [marketId]/
│   │   │   │   └── page.tsx     # Market detail + Apply CTA
│   │   ├── applications/
│   │   │   └── page.tsx         # My applications — status, earnings, PRs
│   │   ├── earnings/
│   │   │   └── page.tsx         # Wallet + cash-out UI
│   │   └── onboarding/
│   │       └── page.tsx         # Email signup → wallet creation → import credentials
│   │
│   ├── hire/                    # REQUESTER APP
│   │   ├── layout.tsx           # Requester nav, org switcher
│   │   ├── page.tsx             # Dashboard (active markets, spend, R-Rep)
│   │   ├── markets/
│   │   │   ├── page.tsx         # My markets list
│   │   │   ├── new/
│   │   │   │   └── page.tsx     # Market creation wizard (step 1-4)
│   │   │   └── [marketId]/
│   │   │       ├── page.tsx     # Market detail + applicant queue
│   │   │       └── grade/
│   │   │           └── page.tsx # Grading interface (one app at a time)
│   │   ├── team/
│   │   │   └── page.tsx         # Invite graders, manage roles
│   │   └── settings/
│   │       └── page.tsx         # Default tiers, ghost timers, auto-rules
│   │
│   └── u/
│       └── [handle]/
│           └── page.tsx         # Public reputation profile (read-only)
│
├── components/                   # Reusable components (shared across surfaces)
│   ├── ui/                      # shadcn/ui primitives (auto-installed)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   └── ...
│   │
│   ├── shared/                  # Echo-specific shared components
│   │   ├── WalletWidget.tsx     # USDC balance + address
│   │   ├── RepBadge.tsx         # P-Rep / R-Rep / G-Rep display
│   │   ├── MarketCard.tsx       # Market preview (title, requester, tier payouts, rep threshold)
│   │   ├── ParticipationReceipt.tsx  # PR NFT display with Arcscan link
│   │   ├── EarningsRow.tsx      # Single earnings entry (market, tier, amount, status)
│   │   ├── GhostTimer.tsx       # Countdown to ghost penalty
│   │   ├── TierPill.tsx         # "Substantive" / "Shortlist" / "Final" badge
│   │   ├── LiveTicker.tsx       # Real-time on-chain activity feed (landing page)
│   │   └── ArcscanLink.tsx      # "View on Arcscan" external link
│   │
│   ├── layout/                  # Layout components
│   │   ├── Navbar.tsx           # Top navigation (marketing nav vs. app nav)
│   │   ├── Sidebar.tsx          # App sidebar (apply vs hire)
│   │   └── Footer.tsx           # Marketing footer
│   │
│   ├── forms/                   # Form-specific components
│   │   ├── MarketWizard.tsx     # Step 1-4: Define → Tiers → Fund → Publish
│   │   ├── ApplicationEditor.tsx # Rich text + file upload for submissions
│   │   ├── GradingRubric.tsx    # Structured grading UI
│   │   └── OrgOnboarding.tsx    # Company verification flow
│   │
│   └── marketing/               # Landing page sections
│       ├── Hero.tsx
│       ├── HowItWorks.tsx
│       ├── TestimonialCard.tsx
│       ├── LiveCounter.tsx      # "$X paid this week" animated number
│       └── RecentEvents.tsx     # Live ticker section
│
├── hooks/                        # Custom React hooks
│   ├── useWallet.ts             # Wagmi wallet state + Circle SCA
│   ├── useRep.ts                # Fetch reputation profile (SWR)
│   ├── useMarkets.ts            # Browse markets (SWR + filters)
│   ├── useMarket.ts             # Single market detail
│   ├── useApplications.ts       # User's applications
│   ├── useEarnings.ts           # Earnings history
│   ├── useApply.ts              # Mutation: submit application
│   ├── useGrade.ts              # Mutation: grade a submission
│   ├── useGhostTimer.ts         # Countdown timer for ghost deadline
│   └── useArcscan.ts            # Generate Arcscan URLs
│
├── lib/                          # Utilities + configuration
│   ├── wagmi.ts                 # wagmi config (chains, connectors, transports)
│   ├── urql.ts                  # GraphQL client config
│   ├── circle.ts                # Circle SCA wallet helpers
│   ├── viem.ts                  # viem client + contract instances
│   ├── constants.ts             # Contract addresses, chain config, tier defaults
│   └── utils.ts                 # Formatters (USDC, dates, addresses), helpers
│
├── types/                        # Frontend-specific types
│   ├── market.ts                # Market, Tier, MarketStatus
│   ├── application.ts           # Application, Submission, Grade
│   ├── reputation.ts            # P-Rep, R-Rep, G-Rep, ReputationEvent
│   └── wallet.ts                # Wallet types, transaction types
│
└── public/                       # Static assets
    ├── logo.svg
    └── OG image, favicon, etc.
```

---

## Key Design Decisions

1. **App Router, not Pages Router.** We use RSC for data fetching, client components for interactivity. Mark interactive parts with `"use client"`.
2. **wagmi + viem, not ethers.** Arc is EVM — everything Just Works™. viem is lighter, type-safe.
3. **Dynamic for wallet onboarding.** Circle SCA (smart contract account) creates wallets invisibly for non-crypto users. Email → wallet created → user never sees a seed phrase.
4. **GraphQL indexer for reads, wagmi for writes.** The indexer is the source of truth for complex queries ("my earnings across 20 markets"). wagmi/viem handles direct contract calls ("apply to this market").
5. **No SSR for blockchain data.** Blockchain reads happen client-side (or via RSC server fetches to the indexer). Never call `window.ethereum` from RSC.

---

## State Management

```
+-------------------------------------------+
|           React Server Components           |
|  (default in App Router — fetch from        |
|   GraphQL indexer, pass as props)           |
+-------------------------------------------+
                    ↓
+-------------------------------------------+
|           Client Components                 |
|  (marked "use client" — wagmi, SWR)         |
|                                             |
|   wagmi: wallet state, contract writes      |
|   SWR:  cached GraphQL reads, optimistic UI |
|   React state: local UI (forms, modals)     |
+-------------------------------------------+
```

---

## Wagmi Configuration (Draft)

```typescript
// lib/wagmi.ts
import { createConfig, http } from 'wagmi'
import { arcTestnet } from './chains' // custom chain definition

export const config = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_RPC_URL),
  },
})
```

Arc is not in wagmi's built-in chains — you'll define it in `lib/chains.ts`.

---

## GraphQL Queries You'll Use

```graphql
# Browse markets (with filters)
query Markets($minRep: Int, $marketType: String, $status: MarketStatus) {
  markets(minRep: $minRep, type: $marketType, status: $status) {
    id
    title
    requester { name rRep }
    tierPayouts
    minPRep
    ghostPenalty
    applicantCount
    status
  }
}

# My applications + earnings
query MyApplications($participantId: String!) {
  applications(participantId: $participantId) {
    id
    market { title requester { name } }
    status
    tierReached
    totalEarned
    prTokenId
    ghostDeadline
  }
}

# Reputation profile
query RepProfile($agentId: String!) {
  reputation(agentId: $agentId) {
    pRep rRep gRep
    totalMarkets
    ghostRate
    history { type market delta timestamp }
    achievements
  }
}
```

---

## Critical Paths to Build First

1. **Onboarding flow** (email → wallet creation → credential import)
2. **Market browser** (filtered list → detail → apply)
3. **Application dashboard** (status, earnings, PRs with Arcscan links)
4. **Market creation wizard** (4 steps → fund → publish)
5. **Grading interface** (single application view → rubric → mark tier)
6. **Live ticker on landing page** (recent on-chain events)

---

## Testing Your Code

```bash
# Inside apps/web/
pnpm dev          # Local dev server (localhost:3000)
pnpm build        # Production build
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright E2E
```

Write component tests for `<MarketCard>`, `<GradingRubric>`, `<WalletWidget>`.
Write E2E for: apply → submit → see receipt; create market → fund → grade.

---

## Working with the Contracts Team

The contracts team owns `packages/contracts/` and `packages/sdk/`. You consume:

- `packages/sdk` → drop-in client for contract calls. Import it.
- `packages/types` → shared TypeScript interfaces. Import them.

When contract ABIs change, the SDK version bumps. Update `apps/web/package.json` to match.

Do NOT write raw contract calls in the frontend. Use the SDK. If the SDK is missing a function, ask the contracts contributor to add it.

---

## Accessibility Requirements

- All forms have `label` elements
- All interactive elements keyboard-navigable
- `aria-live` regions for live ticker
- Focus trap in modals
- Color contrast ≥ WCAG AA

---

*Questions? Tag `@frontend` in issues or PRs.*
