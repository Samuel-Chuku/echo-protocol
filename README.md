# Echo Protocol — The LP Layer for Human Markets

Built on Arc (Circle), settled in USDC. Paying participants who show up and lose.

---

## Quick Links

| Doc | Purpose | Audience |
|-----|---------|----------|
| `docs/specification/ECHO_PROTOCOL.md` | Full technical spec (Section 1-14) | Everyone |
| `docs/guidelines/ARCHITECTURE.md` | Technical architecture — how components wire together | Engineers |
| `docs/guidelines/FRONTEND_GUIDE.md` | Frontend surface, file map, component hierarchy | Frontend contributor |
| `docs/guidelines/BACKEND_GUIDE.md` | Indexer surface, job queues, API contracts | Backend contributor |
| `docs/guidelines/BRANCHING.md` | Git branching strategy + PR checklist | All contributors |
| `docs/guidelines/SETUP.md` | Environment setup step-by-step | New contributor |
| `CONTRIBUTING.md` | How to contribute, file a PR, ask questions | All contributors |
| `CLAUDE.md` | Kimi memory — how I should behave on this project | Kimi only |

---

## Project Structure

```
echo-protocol/
├── apps/
│   ├── web/              # Next.js 15 — echo.xyz (apply, hire, profiles, landing)
│   └── indexer/          # Node.js + GraphQL — reputation event aggregator
├── packages/
│   ├── contracts/        # Solidity 0.8.26 — Foundry — Arc target
│   ├── sdk/              # TypeScript — viem client for external builders
│   └── types/            # Shared TypeScript interfaces (cross-package)
├── docs/
│   ├── specification/    # Full protocol spec (copied from echo-protocol.md)
│   ├── architecture/     # Diagrams, contract call flows, data models
│   ├── api/              # API reference (auto-generated + handwritten)
│   ├── guidelines/       # Team guides (FRONTEND, BACKEND, BRANCHING, SETUP)
│   └── assets/           # Logos, diagrams, marketing media
├── scripts/              # Deployment scripts, seed scripts
└── CLAUDE.md             # Kimi context for this project
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Chain | Arc (EVM-compatible, native USDC) |
| Smart Contracts | Solidity 0.8.26 + Foundry |
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| Blockchain Client | viem + wagmi |
| Wallets | Dynamic (ERC-4337) or Circle SCA |
| Backend / Indexer | Node.js + TypeScript + Express + GraphQL |
| Database | PostgreSQL (indexer cache + off-chain metadata) |
| Reputation Compute | Off-chain TypeScript engine over ERC-8004 event logs |
| ZK Identity | World ID (Phase 2) — Phase 1: stake-based pseudonyms |
| Deployment | Foundry scripts → Arc Testnet |
| Hosting | Vercel (web), Render/Railway (indexer), Fly.io (planned) |

---

## Status

| Milestone | Status | Issue |
|-----------|--------|-------|
| Repo scaffold | 🔄 In progress | — |
| Core contracts (`MarketRegistry`, `EchoHook`) | ⏳ Pending | #1 |
| Reputation indexer | ⏳ Pending | #2 |
| `echo.xyz/apply` (participant app) | ⏳ Pending | #3 |
| `echo.xyz/hire` (requester app) | ⏳ Pending | #4 |
| Public reputation profiles | ⏳ Pending | #5 |
| Arc Testnet live deployment | ⏳ Pending | #6 |
| 5 seed markets + 50 simulated applicants | ⏳ Pending | #7 |

---

## License

MIT — See `LICENSE` file.

---

*Last updated: 2026-06-07*
