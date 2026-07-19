export const typeDefs = /* GraphQL */ `
  type Query {
    "Browse markets. mode: 0 Open/Reveal, 1 DirectJob, 2 Bounty. openOnly = status 'active'."
    markets(mode: Int, status: String, requester: String, openOnly: Boolean, limit: Int): [Market!]!
    market(id: Int!): Market
    marketApplications(marketId: Int!): [Application!]!
    applications(participant: String!): [Application!]!
    findings(marketId: Int!): [Finding!]!
    milestones(marketId: Int!): [Milestone!]!
    "Activity for a wallet (as actor or as the market's requester). status: PENDING | COMPLETED."
    activity(address: String!, status: String, limit: Int): [Activity!]!
    "Full event timeline for a single market — oldest → newest. Drives the per-market timeline UI."
    marketActivity(marketId: Int!, limit: Int): [Activity!]!
    disputes(status: Int): [Dispute!]!
    "Per-address reputation rollup (raw counters from EchoHook). null when no events yet."
    reputation(address: String!): Reputation
    """
    Fetch an off-chain content blob (apply body / per-tier deliverable). The indexer trusts the
    client-claimed viewer address and enforces role gating against on-chain state: apply readable
    by participant always or by requester after reveal; deliver readable by the Arc job's provider
    or evaluator. Demo-grade — there is no cryptographic proof the caller is 'viewer'; gating is
    UX, not privacy. Replace with E2E encryption before mainnet (see memory: echo-content-channel-gap).
    """
    content(marketId: Int!, kind: String!, key: String!, viewer: String!): Content
    "File attachments for {kind,key}, gated identically to content (same viewer rules). METADATA ONLY (data is null); fetch bytes via attachmentData. Empty list when none."
    attachments(marketId: Int!, kind: String!, key: String!, viewer: String!): [Attachment!]!
    "One attachment's bytes (base64 data) by id — gated against the row's own slot. Used on download and by the agent."
    attachmentData(id: String!, viewer: String!): Attachment
    health: Health!
  }

  type Mutation {
    "Store off-chain content. Caller passes the claimed author address; the indexer enforces author-rules against on-chain state (apply → must equal the key; deliver → must equal the Arc job's provider) but does NOT verify the caller actually controls that address. Demo-grade."
    storeContent(marketId: Int!, kind: String!, key: String!, body: String!, author: String!): Content!
    "Upload one file attachment (base64 data) for {kind,key}. Author-gated like storeContent; raw size capped (docs-only). Appends a new file."
    storeAttachment(marketId: Int!, kind: String!, key: String!, filename: String!, mime: String!, data: String!, author: String!): Attachment!
    "Delete an attachment by id. Only the original uploader (author) may delete."
    deleteAttachment(id: String!, author: String!): Boolean!
  }

  type Content {
    id: String!
    marketId: Int!
    kind: String!
    key: String!
    author: String!
    body: String!
    hash: String!
    createdAt: Int!
  }

  type Attachment {
    id: String!
    marketId: Int!
    kind: String!
    key: String!
    author: String!
    filename: String!
    mime: String!
    size: Int!
    "Base64 file bytes. Null in the attachments list (metadata-only); populated by attachmentData."
    data: String
    hash: String!
    createdAt: Int!
  }

  type Market {
    id: Int!
    mode: Int!
    requester: String!
    requesterAgentId: String
    worker: String
    subject: String
    description: String
    scopeHash: String
    tiers: [String!]
    escrowTotal: String
    revealFee: String
    flagWindow: Int
    stakeRequired: String
    defaultAward: String
    pool: String
    reviewWindow: Int
    ghostDeadline: Int
    status: String!
    applicantCount: Int!
    createdAt: Int!
    "Sum of indexed TierPayout amounts (base units) — USDC actually paid to workers so far. Derived from events, so pages can show progress without an RPC read. (Not full escrow accounting: reveal fees / ghost reserves / protocol fees are separate legs.)"
    paidOut: String!
  }

  type Application {
    id: ID!
    marketId: Int!
    participant: String!
    agentId: String
    tierReached: Int!
    status: String!
    receiptId: String
    submissionHash: String
    createdAt: Int!
  }

  type Finding {
    id: ID!
    marketId: Int!
    idx: Int!
    submitter: String!
    findingHash: String
    status: Int!
    award: String
    createdAt: Int!
  }

  type Milestone {
    id: ID!
    marketId: Int!
    idx: Int!
    amount: String
    status: Int!
    deliverableHash: String
    submittedAt: Int
  }

  type Activity {
    id: Int!
    blockNumber: Int!
    txHash: String!
    eventName: String!
    marketId: Int
    actor: String
    args: String!
    state: String!
    createdAt: Int!
  }

  type Dispute {
    id: Int!
    "0 = BountyFinding, 1 = ModeAStake, 2 = TierJobRejection (worker contests a Final-tier reject)."
    subject: Int!
    marketId: Int
    "Finding index for BountyFinding; the Arc jobId for TierJobRejection. Unused for ModeAStake."
    target: Int
    participant: String
    opener: String
    counter: String
    bond: String
    status: Int!
    forOpener: Int!
    against: Int!
    createdAt: Int!
  }

  type Reputation {
    address: String!
    agentId: String
    jobsCompleted: Int!
    totalEarned: String!
    tierSum: Int!
    ghostCount: Int!
    totalSlashed: String!
    rRepSlashes: Int!
    lastEventBlock: Int!
    updatedAt: Int!
  }

  type Health {
    lastBlock: Int!
    headBlock: Int!
    lagBlocks: Int!
    markets: Int!
    events: Int!
    "The ingest loop's LIVE in-memory position — the cursor (lastBlock) only moves on commit, so during a backfill or a stall these two tell different stories."
    ingestBlock: Int!
    "What the loop is doing right now: backfilling / at head / rate-limited (backoff …) / retrying / paused / error."
    ingestState: String!
    "Unix time the loop last reported in — a stale value means the loop itself is stuck or dead."
    ingestUpdatedAt: Int!
    "The cursor value from just before the last ops re-index, if one ever happened."
    prevCursor: Int
    "Per-endpoint health of the Arc RPC pool (60s probes) — which provider is down/slow when users report network trouble."
    rpcEndpoints: [RpcEndpoint!]!
  }

  type RpcEndpoint {
    url: String!
    ok: Boolean!
    latencyMs: Int
    block: Int
    error: String
    checkedAt: Int!
  }
`;
