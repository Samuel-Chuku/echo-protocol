# Architecture — How Echo Protocol Wires Together

## Core Insight

Echo is a **thin orchestration layer** on top of Arc's deployed primitives. ~70% of the protocol is already live on Arc Testnet. Echo adds: `MarketRegistry`, `EchoHook`, `ParticipationReceipt`, plus off-chain reputation compute + consumer apps.

---

## The Three-Layer Stack

```
Layer 1: Identity & Settlement (Arc primitives)
├── World ID (proof-of-personhood)  →  IdentityRegistry NFT (0x8004A8...)
├── EAS attestations (GitHub, prior employers)  →  ValidationRegistry (0x8004Cb...)
└── USDC settlement  ←  native, gas is USDC, sub-second finality

Layer 2: Market Mechanics (Echo contracts)
├── MarketRegistry.sol      ←  creates markets, pools escrow, spawns ERC-8183 jobs
├── EchoHook.sol            ←  hook callbacks: tier payouts, ghost penalty, rep events
├── ParticipationReceipt.sol  ←  ERC-721 proving "I showed up"
└── ERC-8183 AgenticCommerce  ←  Circle-deployed: job escrow + lifecycle

Layer 3: Reputation & Applications (Echo off-chain + frontend)
└── Reputation Indexer      ←  reads ERC-8004 ReputationRegistry events
    ├── P-Rep / R-Rep / G-Rep score engine
    ├── ZK-proof generation (Phase 2)
    └── GraphQL API

Layer 4: Consumer Surfaces (Echo applications)
├── echo.xyz/apply          ←  participant: browse, apply, earn, withdraw
├── echo.xyz/hire           ←  requester: create market, grade, track spend
├── echo.xyz/u/<handle>     ←  public reputation profile
└── SDK                     ←  for third-party vertical builders
```

---

## Data Flow: A Full Hiring Market Lifecycle

### 1. Requester Creates Market

```
Hiring Manager @ Stripe
    ↓
echo.xyz/hire → "New Market Wizard"
    ↓
MarketRegistry.createMarket()
    ├── title: "Senior Backend (Payments Core)"
    ├── scope_hash: 0xabc...        ←  commitment, actual text off-chain
    ├── tier payouts: [$5, $50, $250]
    ├── ghost penalty: $1,000
    ├── ghost deadline: 14 days
    ├── expected applicants: 250
    ├── P-Rep threshold: 600
    └── min escrow: $42K (250 × tiers + ghost reserve)
    ↓
Stripe funds escrow → MarketRegistry.fundMarket() → USDC → EscrowVault
```

### 2. Participant Applies

```
Sarah (P-Rep 880)
    ↓
echo.xyz/apply → "Browse Markets"
    ↓
Filtered to markets with P-Rep ≤ 880
    ↓
"Apply to Stripe Senior Backend"
    ↓
ParticipationReceipt.mintReceipt(marketId, submissionHash)
    ├── submission content: encrypted to Stripe off-chain
    ├── submission_hash: on-chain commitment
    └── timestamp + participantId (ZK-derived)
    ↓
Arc Testnet confirms in 600ms → Arcscan link shown to Sarah
```

### 3. Requester Grades / Tier Advancement

```
Stripe Hiring Manager
    ↓
echo.xyz/hire → "Grade Applications"
    │
    ├── Marks Sarah "Substantive"
    │   ↓
    │   EchoHook.onComplete() triggered
    │       ├── ERC-8183 Job #1 created: budget = $5
    │       ├── USDC released to Sarah's wallet
    │       ├── P-Rep event written to ReputationRegistry
    │       └── PR metadata updated
    │
    ├── Advances Sarah to "Phone Screen" (Tier 2)
    │   ↓
    │   EchoHook → ERC-8183 Job #2: budget = $50, hook = EchoHook
    │       ├── $50 released on screen completion
    │       └── P-Rep + R-Rep events written
    │
    └── Advances Sarah to "On-site" (Tier 3)
        ↓
        EchoHook → ERC-8183 Job #3: budget = $250, hook = EchoHook
            └── ghost timer starts: 14 days
```

### 4. Ghost Penalty (or Clean Close)

```
Scenario A: Stripe picks another candidate, sends feedback within 7 days
    ↓
Stripe calls complete() on all jobs → EchoHook.onComplete()
    ├── No ghost penalty (completed before deadline)
    ├── R-Rep increases (fast responder)
    └── Remaining escrow returned to Stripe

Scenario B: Stripe ghosts after on-site, 14 days pass
    ↓
Anyone calls expire() on Job #3 → EchoHook.onExpire()
    ├── Ghost timer expired → $1,000 released to Sarah
    ├── R-Rep slashed on Stripe
    ├── REP.acceptFeedback(requesterId, participantId, "ghosted", ...)
    └── Automatic peer-review queue entry
```

### 5. Reputation Computation (Off-Chain)

```
Reputation Indexer polls ReputationRegistry events
    ↓
For each event:
    ├── "tier_pass" → increment P-Rep score
    ├── "ghosted"   → slash R-Rep score
    ├── "rep_boost" → increment G-Rep score
    └── Timestamp for decay calculation
    ↓
Score aggregation:
    ├── P-Rep = Σ(tier_pass weights) × recency × domain_bonus
    ├── R-Rep = Σ(response_rate + fairness + ghost_free) × volume
    └── G-Rep = Σ(peer_review_quality) × consistency
    ↓
GraphQL API serves scores + proof generation
```

---

## Contract Call Graph

```
[User] ──calls──▶ [MarketRegistry] ──creates──▶ [ERC-8183 Job via AgenticCommerce]
                                  ──mints──▶ [ParticipationReceipt NFT]
                                  ──funds──▶ [EscrowVault]
                                  ──links──▶ [EchoHook]

[Grader] ──calls──▶ [ERC-8183 Job] ──triggers──▶ [EchoHook (callback)]
                                    ├── onComplete() → release USDC
                                    ├── onExpire() → ghost penalty
                                    └── write P-Rep / R-Rep to ReputationRegistry

[Reputation Indexer] ──reads──▶ [ReputationRegistry]
                                   ├── P-Rep events
                                   ├── R-Rep events
                                   └── G-Rep events
                     ──computes──▶ Composite scores
                     ──serves──▶ [GraphQL API] ──consumed by──▶ [Frontend]
```

---

## File → Responsibilities

### Solidity

| File | Role | Reads From | Writes To |
|------|------|------------|-----------|
| `MarketRegistry.sol` | Market factory, escrow pool manager | USDC, IdentityRegistry | ERC-8183 jobs, ParticipationReceipt |
| `EchoHook.sol` | Tier payout, ghost penalty, rep events | ERC-8183 callbacks | ReputationRegistry, USDC transfers |
| `ParticipationReceipt.sol` | NFT receipt of participation | MarketRegistry | On-chain metadata |
| `interfaces/IERC8183.sol` | Arc AgenticCommerce interface | — | — |
| `interfaces/IERC8004.sol` | Arc Identity/Reputation/Validation interfaces | — | — |

### TypeScript / Node

| File | Role | Reads From | Writes To |
|------|------|------------|-----------|
| `indexer/src/listeners/` | Event listeners for all registries | Arc RPC (live) | PostgreSQL |
| `indexer/src/processors/` | Score computation, decay, batching | PostgreSQL | PostgreSQL |
| `indexer/src/routes/` | GraphQL API endpoints | PostgreSQL | HTTP responses |
| `web/src/app/apply/` | Participant UI | GraphQL API + wagmi | Arc Testnet |
| `web/src/app/hire/` | Requester UI | GraphQL API + wagmi | Arc Testnet |
| `web/src/app/u/` | Public profiles | GraphQL API (read-only) | — |
| `sdk/` | Drop-in client for external builders | GraphQL + wagmi | Arc Testnet |

---

## Key Interfaces

### IEchoHook (across ERC-8183 lifecycle)

```solidity
interface IEchoHook {
    function onFund(uint256 jobId, address client, uint256 amount) external;
    function onSubmit(uint256 jobId, bytes32 deliverableHash) external;
    function onComplete(uint256 jobId, bytes32 reasonHash) external;
    function onExpire(uint256 jobId) external;
}
```

### Market Creation (MarketRegistry)

```solidity
function createMarket(
    string calldata metadataURI,          // IPFS hash of full description
    bytes32 scopeHash,                    // commitment to scope details
    uint256[] calldata tierAmounts,       // [5, 50, 250] in USDC decimals
    uint256 ghostPenalty,                 // 1000 * 1e6
    uint256 ghostDeadline,                // seconds from final tier
    uint256 minPRep,                      // 600
    uint256 maxApplicants,                // 250
    uint256 totalEscrow                   // 42000 * 1e6
) external returns (uint256 marketId);
```

### Reputation Query (GraphQL — off-chain)

```graphql
type ReputationProfile {
  agentId: String!
  pRep: Int!
  rRep: Int!
  gRep: Int!
  totalMarkets: Int!
  ghostRate: Float!
  responseTime: Float!  # hours
  history: [ReputationEvent!]!
  achievements: [String!]!  # "Stripe Finalist", "10x Substantive"
}
```

---

## Testing Strategy

| Layer | Tool | What We Test |
|-------|------|--------------|
| Contracts | Forge | Unit tests for all public functions; fuzz tier math; formal verification of escrow waterfall |
| Contract Integration | Forge + cast | Live Arc Testnet: deploy, create market, apply, grade, ghost, verify on Arcscan |
| Indexer | Vitest | Event parsing, score computation correctness, GraphQL query responses |
| Frontend | Playwright | Critical paths: apply → submit → see receipt; create market → fund → grade |
| E2E | Manual | Full Sarah story on testnet with simulated data |

---

## Deployment Targets

| Environment | Network | Purpose |
|-------------|---------|---------|
| Local | Anvil (fork Arc Testnet) | Contract development |
| Testnet | Arc Testnet (chainId 5042002) | Integration testing, demo |
| Staging | Arc Testnet (separate deployer) | Review apps, PR previews |
| Production | Arc Mainnet (when live) | Real USDC, real users |

---

## Security Notes

1. **EchoHook carries all value at risk.** It is the ONLY contract that moves USDC and writes reputation events. It needs independent audit (Trail of Bits / Spearbit even though ERC-8183/8004 are pre-audited).
2. **MarketRegistry escrow math must be formally verified.** The tier waterfall must be provably correct — no over/under payment.
3. **P-Rep gating is anti-discrimination sensitive.** Scores cannot proxy for protected classes. Algorithmic audit required before mainnet.
4. **Ghost penalty is contract-of-adhesion.** T&Cs must be tight. Legal review required.
5. **Non-custodial wherever possible.** Echo Protocol never holds user private keys. Circle SCA wallets or user-owned EOAs.

---

*Last updated: 2026-06-07*
