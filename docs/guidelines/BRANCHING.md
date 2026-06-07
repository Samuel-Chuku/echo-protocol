# Branching Strategy + PR Workflow

## Branching Model: GitHub Flow (Simple)

We use a single long-lived branch: `main`. All work happens in short-lived feature branches.

```
main  ◄──────────────────────────────────────────
       │                                         │
       └── feat/applicant-onboarding  ──► PR ──► merge
       │                                         │
       └── fix/ghost-timer-race        ──► PR ──► merge
       │                                         │
       └── docs/architecture-diagram   ──► PR ──► merge
```

---

## Branch Naming Convention

| Prefix | Use For | Example |
|--------|---------|---------|
| `feat/` | New feature | `feat/applicant-dashboard` |
| `fix/` | Bug fix | `fix/ghost-penalty-race` |
| `docs/` | Documentation only | `docs/setup-guide-update` |
| `refactor/` | Code improvement, no behavior change | `refactor/grade-processor` |
| `test/` | Adding / fixing tests | `test/market-registry-fuzz` |
| `chore/` | Tooling, deps, CI | `chore/upgrade-viem` |
| `hotfix/` | Critical production fix | `hotfix/escrow-overflow` |

**Pattern:** `prefix/description-kebab-case`

**Bad:** `fix`, `my-branch`, `updates`, `feature1`
**Good:** `feat/market-wizard-step-3`, `fix/tier-payout-decimals`

---

## Starting Work — Step by Step

### 1. Pick or Create an Issue

Every branch should be traceable to an issue. If there's no issue for what you're building, create one first.

```
Issue #23 → "Build applicant onboarding flow"
```

### 2. Create Your Branch from `main`

**Run this yourself — I never execute git mutations.**

```bash
git switch main
git pull origin main
git switch -c feat/applicant-onboarding
# or: git checkout -b feat/applicant-onboarding
```

### 3. Work on Your Scope Only

Each branch should touch **one logical area**:

| Contributor | Typical branch scope |
|-------------|---------------------|
| Solidity dev | `packages/contracts/src/core/*.sol` + tests |
| Frontend dev | `apps/web/src/app/apply/` or `apps/web/src/components/shared/` |
| Backend dev | `apps/indexer/src/processors/` or `apps/indexer/src/routes/` |

Do NOT mix contract changes with frontend changes in the same PR. Exception: the contracts team updates the SDK (`packages/sdk/`) to expose new ABIs, and the frontend team consumes them in a separate PR.

### 4. Commit Often, Commit Well

```bash
git add packages/contracts/src/core/MarketRegistry.sol
git commit -S -m "feat: MarketRegistry createMarket with escrow validation

- Enforces min escrow >= sum(tiers) + ghost reserve
- Emits MarketCreated event with all params
- Adds custom error InsufficientEscrow(uint256 provided, uint256 required)

Closes #23"
```

Note:
- `-S` = GPG signed (required)
- Commit message format: `type: imperative description`
- Body explains what + why, not just what
- Reference the issue: `Closes #23`

### 5. Push and Open PR

```bash
git push -u origin feat/applicant-onboarding
gh pr create --title "feat: applicant onboarding flow" --body "Closes #23. Implements email signup, wallet creation, and credential import." --base main
```

Or use GitHub UI → "Compare & pull request"

### 6. PR Template (Fill This Out)

```markdown
## What
Brief description of the change.

## How
Technical approach — what changed and why.

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual test on Arc Testnet (if contract change)

## Screenshots / Loom
(If UI change)

## Linked Issue
Closes #23
```

### 7. Code Review

- At least **1 review required** before merge.
- Reviewer checks:
  - Logic correctness
  - Test coverage
  - Documentation updates (if API changed)
  - Security (if contract change)
- Address feedback, push new commits, re-request review.

### 8. Merge

```bash
# After approval, merge via GitHub UI or:
git switch main
git pull origin main
git merge feat/applicant-onboarding  # or: gh pr merge 42 --squash
```

**Squash merge preferred** for feature branches. Keeps `main` clean.

**Do not merge your own PR** without review (emergency hotfixes excepted).

---

## Cross-Contributor Workflow

When two contributors are working on related features:

```
Contributor A (contracts):  feat/market-registry-escrow
  ↓
  Opens PR #1
  ↓
  Merges to main
  ↓
Contributor B (frontend) pulls main, starts:
  feat/applicant-apply-flow
  ↓
  Uses new SDK methods from A's merge
```

**Never rebase someone else's branch.** If you need A's work before A merges, branch from A's branch explicitly and note it in the PR description.

---

## Monorepo Package Boundaries

Each contributor owns a slice:

| Package | Owner | Other contributors read-only |
|---------|-------|------------------------------|
| `packages/contracts/` | Solidity dev | Backend (reads ABIs), Frontend (reads via SDK) |
| `packages/sdk/` | Solidity dev | Frontend (imports as dependency) |
| `packages/types/` | All (shared) | Anyone can add shared types |
| `apps/web/` | Frontend dev | Backend (not needed), Solidity (not needed) |
| `apps/indexer/` | Backend dev | Frontend (consumes GraphQL), Solidity (not needed) |

**Rule:** If you need to change a package you don't own, open a separate PR or ask the owner.

---

## Merge Conflicts

```bash
git switch main
git pull origin main
git switch your-feature-branch
git rebase main
# Fix conflicts in your editor
git add .
git rebase --continue
git push --force-with-lease
```

**Run these yourself — I do not execute git commands.**

---

## Review Culture

- Reviews within 24 hours during active development.
- Be direct, be kind. "This function is hard to follow" is better than "maybe you could refactor this?"
- Approve with confidence. If you're unsure, ask questions, don't rubber-stamp.

---

*Last updated: 2026-06-07*
