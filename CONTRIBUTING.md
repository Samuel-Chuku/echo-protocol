# Contributing to Echo Protocol

Thank you for building with us. Echo is thin orchestration over Arc's deployed primitives (ERC-8183 + ERC-8004). We keep it simple.

---

## How to Start

1. Read `docs/guidelines/SETUP.md` — install prerequisites
2. Read `docs/guidelines/ARCHITECTURE.md` — understand how components wire
3. Read `docs/guidelines/BRANCHING.md` — how to branch, commit, PR
4. Pick an issue from the issue tracker. Ask in the channel if unsure.

---

## Code Style

### Solidity
- `forge fmt` auto-formats. Run it before commit.
- NatSpec on all public/external functions.
- Custom errors, not revert strings: `error GhostPenaltyExpired(uint256 jobId)`
- Named returns discouraged; use explicit `return` for clarity.

### TypeScript
- `eslint` + `prettier` configured in each package. Run `pnpm lint` before commit.
- No `any` without `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Prefer `viem` types over raw `string` for addresses.

### General
- One PR = one logical change. Don't mix contract + frontend in same PR unless unavoidable.
- Include tests. Solidity: Forge tests. TypeScript: Vitest.
- Update docs if you change a public API or contract interface.

---

## PR Checklist

- [ ] Branch follows naming convention (`feat/`, `fix/`, `docs/`, `refactor/`)
- [ ] Issue linked in PR description (`Closes #N`)
- [ ] Tests pass (`forge test` or `pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] No `console.log` in production code
- [ ] .env changes documented in `.env.example`
- [ ] Contract changes: at least one integration test against Arc Testnet

---

## Communication

- GitHub Issues for bugs, features, and technical questions
- PR reviews are for code quality — be direct, be kind
- "I don't understand this" is a valid review comment

---

## Scope Boundaries (What NOT to Build Here)

| Out of Scope | Where It Lives |
|--------------|----------------|
| ZK proving circuit | Separate repo: `echo-zk-identity` (Phase 2) |
| World ID integration | Core protocol first; identity bridge later |
| Mobile native app | Web PWA only for now |
| Token launch / governance | USDC-only protocol. No token decisions until mainnet v2. |

---

*All commits must be signed. See `docs/guidelines/SETUP.md` for GPG setup.*
