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
    disputes(status: Int): [Dispute!]!
    health: Health!
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
    subject: Int!
    marketId: Int
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

  type Health {
    lastBlock: Int!
    headBlock: Int!
    lagBlocks: Int!
    markets: Int!
    events: Int!
  }
`;
