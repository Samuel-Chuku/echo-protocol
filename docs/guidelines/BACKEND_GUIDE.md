# Backend Guide — `apps/indexer`

## Your Surface Area

You own everything in `apps/indexer/src/`. This is the **reputation engine and data layer**:

1. **Event listeners** — real-time ingestion from Arc testnet RPC
2. **Processors** — score computation, decay, batching, aggregation
3. **GraphQL API** — serves frontend queries (markets, profiles, earnings)
4. **Seed scripts** — populate test data for demo

The indexer does NOT move money. It reads on-chain events, computes off-chain scores, and serves structured data.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 22 (LTS) |
| Language | TypeScript 5.4 |
| Server | Express 4.x |
| GraphQL | Apollo Server 4 + express |
| DB | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Migrations | Drizzle Kit |
| Event Streaming | Custom WebSocket sub to Arc RPC |
| Scheduling | node-cron |
| Testing | Vitest |

---

## File Map — Where Everything Lives

```
apps/indexer/src/
├── listeners/                    # Real-time event ingestion
│   ├── arcRpc.ts                # WebSocket connection to Arc testnet
│   ├── reputationRegistry.ts    # Listen to ReputationRegistry (0x8004B6...)
│   ├── agenticCommerce.ts       # Listen to ERC-8183 jobs (0x0747EE...)
│   ├── marketRegistry.ts        # Listen to our MarketRegistry events
│   └── participationReceipt.ts  # Listen to PR mints/transfers
│
├── processors/                   # Business logic — compute scores
│   ├── pRepProcessor.ts         # Participant Reputation logic
│   ├── rRepProcessor.ts         # Requester Reputation logic
│   ├── gRepProcessor.ts         # Grader Reputation logic
│   ├── decayEngine.ts           # Time-based decay for all scores
│   ├── ghostDetector.ts         # Detect expired ghost timers, trigger alerts
│   ├── batchProcessor.ts        # Batch process historical blocks on restart
│   └── anomalyDetector.ts       # Statistical outlier detection for grading fairness
│
├── services/                     # Core services
│   ├── eventStore.ts            # Upsert events to PostgreSQL
│   ├── scoreService.ts          # CRUD for computed scores
│   ├── marketService.ts         # CRUD for markets (cache of on-chain state)
│   ├── applicationService.ts    # Track applications + tier transitions
│   └── seedService.ts           # Demo data generation
│
├── routes/                       # API surface
│   ├── graphql/                 # Apollo Server + schema + resolvers
│   │   ├── schema.ts            
│   │   ├── resolvers.ts         
│   │   └── context.ts           
│   ├── health.ts                # /health → uptime, lag, last block
│   └── webhook.ts               # Circle webhook handlers (Phase 2)
│
├── types/                        # Indexer-specific types
│   ├── events.ts                # Normalized event types from all registries
│   ├── scores.ts                # Score data structures
│   └── api.ts                   # GraphQL type definitions
│
├── db/                           # Drizzle ORM
│   ├── schema.ts                # Table definitions
│   ├── migrations/              # Auto-generated drizzles
│   └── client.ts                # Drizzle client singleton
│
└── index.ts                      # Entry point: boot listeners, start server
```

---

## Database Schema (Draft)

```sql
-- Events (raw from chain — immutable source of truth)
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  block_number BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INT NOT NULL,
  contract_address TEXT NOT NULL,    -- which registry emitted this
  event_type TEXT NOT NULL,          -- "tier_pass", "ghosted", "rep_boost", etc.
  agent_id TEXT NOT NULL,            -- who this event is about
  counterparty_id TEXT,              -- the other party if any
  market_id INT,                     -- if applicable
  amount NUMERIC,                    -- USDC amount if monetary
  metadata JSONB,                    -- flexible extra data
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(block_number, tx_hash, log_index)
);

-- Computed scores (recomputed on demand + batched)
CREATE TABLE scores (
  agent_id TEXT PRIMARY KEY,
  p_rep INT DEFAULT 0,
  r_rep INT DEFAULT 0,
  g_rep INT DEFAULT 0,
  total_markets INT DEFAULT 0,
  total_earned NUMERIC DEFAULT 0,
  ghost_rate FLOAT DEFAULT 0,        -- 0.0 to 1.0
  avg_response_time FLOAT,           -- hours
  last_updated TIMESTAMP DEFAULT NOW(),
  snapshot JSONB                     -- full history for debugging
);

-- Markets (cache of on-chain state for fast queries)
CREATE TABLE markets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  description TEXT,
  tier_payouts INT[] NOT NULL,       -- [5, 50, 250] in USDC cents
  min_p_rep INT NOT NULL,
  ghost_penalty INT NOT NULL,
  ghost_deadline_hours INT NOT NULL,
  status TEXT NOT NULL,              -- "active", "paused", "closed"
  escrow_total NUMERIC NOT NULL,
  escrow_spent NUMERIC DEFAULT 0,
  applicant_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Applications (participant ↔ market linkage)
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  submission_hash TEXT,
  status TEXT NOT NULL,              -- "submitted", "substantive", "shortlist", "final", "rejected", "ghosted"
  tier_reached INT DEFAULT 0,        -- 0 = submitted only, 1 = substantive, etc.
  total_earned NUMERIC DEFAULT 0,
  pr_token_id TEXT,
  ghost_deadline TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert/update triggers
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

---

## Event Flow

```
Arc Testnet emits event
    ↓
arcRpc listener (WebSocket)
    ↓
Normalize to Event type
    ↓
eventStore.upsert(event) → PostgreSQL
    ↓
Trigger processor (async queue)
    ├── tier_pass → pRepProcessor.addPoints()
    ├── ghosted → rRepProcessor.slash()
    ├── rep_boost → gRepProcessor.addPoints()
    └── grade_mark → anomalyDetector.log()
    ↓
Update scores table
    ↓
Frontend GraphQL query → fresh score
```

---

## Score Computation Logic (P-Rep Example)

```typescript
// processors/pRepProcessor.ts

interface PRepInputs {
  tierPasses: Event[];      // "my submission was graded substantive"
  ghostedAsParticipant: Event[];  // "I was ghosted" (negative)
  vouches: Event[];         // "counterparty vouched for me"
  tierAmounts: number[];    // payout values per tier reached
}

function computePRep(inputs: PRepInputs): number {
  let score = 0;

  // Base points for each substantive grade
  for (const pass of inputs.tierPasses) {
    const tierWeight = TIER_WEIGHTS[pass.metadata.tierIndex]; // [100, 500, 2000]
    const ageFactor = decayFactor(pass.timestamp, HALF_LIFE_DAYS);
    score += tierWeight * ageFactor;
  }

  // Bonus for counterparty vouches
  for (const vouch of inputs.vouches) {
    const vouchWeight = Math.min(voucherPRep / 1000, 1) * 500;
    score += vouchWeight;
  }

  // Penalty for being ghosted as participant
  for (const ghost of inputs.ghostedAsParticipant) {
    score -= 200; // modest personal penalty
  }

  // Decay entire score over time
  const lastEvent = Math.max(...allEvents.map(e => e.timestamp));
  score *= decayFactor(lastEvent, HALF_LIFE_DAYS);

  return Math.max(0, Math.min(score, 10000)); // clamp 0-10000
}

const HALF_LIFE_DAYS = 180; // reputation halves after 6 months of inactivity
```

---

## GraphQL Schema

```graphql
type Query {
  # Markets
  markets(filters: MarketFilters): [Market!]!
  market(id: ID!): Market
  
  # Applications
  applications(participantId: ID!): [Application!]!
  application(id: ID!): Application
  
  # Reputation
  reputation(agentId: ID!): ReputationProfile
  reputationLeaderboard(limit: Int, offset: Int): [ReputationProfile!]!
  
  # System health
  health: HealthStatus!
  syncStatus: SyncStatus!
}

type Market {
  id: ID!
  title: String!
  requester: Requester!
  description: String
  scopeHash: String
  tierPayouts: [Int!]!
  minPRep: Int!
  ghostPenalty: Int!
  ghostDeadlineHours: Int!
  status: MarketStatus!
  escrowTotal: String!  # USDC in base units
  escrowSpent: String!
  applicantCount: Int!
  createdAt: String!
  expiresAt: String
}

type Application {
  id: ID!
  market: Market!
  participant: Participant!
  submissionHash: String
  status: ApplicationStatus!
  tierReached: Int!
  totalEarned: String!
  prTokenId: String
  ghostDeadline: String
  createdAt: String!
  updatedAt: String!
}

type ReputationProfile {
  agentId: ID!
  pRep: Int!
  rRep: Int!
  gRep: Int!
  totalMarkets: Int!
  totalEarned: String!
  ghostRate: Float!
  avgResponseTime: Float
  history: [RepEvent!]!
  achievements: [String!]!
}
```

---

## API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/graphql` | POST | All data queries |
| `/health` | GET | Uptime, last synced block, event lag |
| `/webhook/circle` | POST | Circle webhook (Phase 2) |

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/echo_indexer

# Arc RPC
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002

# Contract addresses (Echo + Arc primitives)
MARKET_REGISTRY_ADDRESS=0x...
ECHO_HOOK_ADDRESS=0x...
ERC_8183_ADDRESS=0x0747EEf0...4583
ERC_8004_IDENTITY=0x8004A818...
ERC_8004_REPUTATION=0x8004B663...
ERC_8004_VALIDATION=0x8004Cb1B...

# Indexing config
START_BLOCK=0           # where to start backfill
POLL_INTERVAL_MS=3000   # how often to poll for new blocks
BATCH_SIZE=1000         # events per batch

# Server
PORT=4000
NODE_ENV=development
```

---

## Working with the Frontend Team

The frontend team owns `apps/web/`. You serve them via GraphQL.

When the frontend asks for a new query field, add it to `schema.ts` → implement in `resolvers.ts` → add DB query in the appropriate service.

When contract events change, update the listeners and event normalization logic. The frontend should never need to know about raw log topics.

Keep the GraphQL API stable. Frontend code depends on field names. If you must break, announce in the team channel and coordinate deprecation.

---

## Testing Your Code

```bash
# Inside apps/indexer/
pnpm dev          # Start server with hot reload
pnpm test         # Vitest unit tests
pnpm test:db      # Integration tests with test DB
pnpm db:push      # Push schema to DB
pnpm db:studio    # Drizzle Studio GUI
```

Test critical paths:
1. Event ingestion → event stored in DB
2. P-Rep computation → correct score after N events
3. Ghost detection → alert when deadline passes
4. GraphQL query → returns expected shape

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Event ingestion lag | < 5 seconds behind chain head |
| GraphQL query latency (p95) | < 200ms |
| Score recomputation | < 1 second per profile |
| Backfill speed | > 1000 blocks/second |
| API uptime | 99.9% (measured on /health) |

---

## Deployment

| Environment | Strategy |
|-------------|----------|
| Local | `pnpm dev` + local PostgreSQL |
| Testnet | Docker Compose → Render or Railway |
| Production | Managed PostgreSQL + Fly.io / Render |

---

*Questions? Tag `@backend` in issues or PRs.*
