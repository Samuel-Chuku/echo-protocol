import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// bigint amounts (USDC base units, block numbers that may exceed 2^53) are stored as TEXT.

/** Single-row ingestion cursor: the last fully-indexed block. */
export const cursor = sqliteTable('cursor', {
  id: text('id').primaryKey(), // always 'head'
  lastBlock: integer('last_block').notNull().default(0),
});

/** Raw decoded log — immutable history, drives the activity feed. */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blockNumber: integer('block_number').notNull(),
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  address: text('address').notNull(),
  eventName: text('event_name').notNull(),
  marketId: integer('market_id'),
  // the wallet/agent this event is primarily "about" (participant, submitter, requester…)
  actor: text('actor'),
  args: text('args').notNull(), // JSON (bigints stringified)
  createdAt: integer('created_at').notNull(),
});

/** Derived market state (all three modes). mode: 0 Open/Reveal, 1 DirectJob, 2 Bounty. */
export const markets = sqliteTable('markets', {
  id: integer('id').primaryKey(), // marketId
  mode: integer('mode').notNull(),
  requester: text('requester').notNull(),
  requesterAgentId: text('requester_agent_id'),
  worker: text('worker'), // Mode B
  subject: text('subject'),
  description: text('description'),
  metadataURI: text('metadata_uri'),
  scopeHash: text('scope_hash'),
  tiers: text('tiers'), // JSON [r, shortlist, final, ghost] for Open
  escrowTotal: text('escrow_total'),
  revealFee: text('reveal_fee'),
  flagWindow: integer('flag_window'),
  stakeRequired: text('stake_required'),
  defaultAward: text('default_award'), // Bounty
  pool: text('pool'), // Bounty
  reviewWindow: integer('review_window'), // Mode B / Bounty
  ghostDeadline: integer('ghost_deadline'), // Open: seconds until the Final-tier ghost penalty
  status: text('status').notNull().default('active'), // active | closed | cancelled
  applicantCount: integer('applicant_count').notNull().default(0),
  createdAtBlock: integer('created_at_block').notNull().default(0),
  createdAt: integer('created_at').notNull().default(0),
});

/** Open-market applications (participant ↔ market). */
export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(), // `${marketId}-${participant}`
  marketId: integer('market_id').notNull(),
  participant: text('participant').notNull(),
  agentId: text('agent_id'),
  tierReached: integer('tier_reached').notNull().default(0),
  status: text('status').notNull().default('applied'), // applied | revealed | shortlist | final | ghosted
  receiptId: text('receipt_id'),
  submissionHash: text('submission_hash'),
  createdAt: integer('created_at').notNull().default(0),
});

/** Bounty findings. status: 0 Pending, 1 Accepted, 2 Rejected, 3 Disputed. */
export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(), // `${marketId}-${idx}`
  marketId: integer('market_id').notNull(),
  idx: integer('idx').notNull(),
  submitter: text('submitter').notNull(),
  submitterAgentId: text('submitter_agent_id'),
  findingHash: text('finding_hash'),
  status: integer('status').notNull().default(0),
  award: text('award'),
  createdAt: integer('created_at').notNull().default(0),
});

/** Direct-job milestones. status: 0 Pending, 1 Submitted, 2 Released. */
export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(), // `${marketId}-${idx}`
  marketId: integer('market_id').notNull(),
  idx: integer('idx').notNull(),
  amount: text('amount'),
  status: integer('status').notNull().default(0),
  deliverableHash: text('deliverable_hash'),
  submittedAt: integer('submitted_at'),
});

/** Mode-A reveal stake holds. status: 0 None, 1 Held, 2 Flagged, 3 Settled. */
export const revealHolds = sqliteTable('reveal_holds', {
  id: text('id').primaryKey(), // `${marketId}-${participant}`
  marketId: integer('market_id').notNull(),
  participant: text('participant').notNull(),
  status: integer('status').notNull().default(1),
  revealedAt: integer('revealed_at'),
});

/** Disputes (DisputeResolver). subject: 0 BountyFinding, 1 ModeAStake. status: 0 Open, 1 Resolved. */
export const disputes = sqliteTable('disputes', {
  id: integer('id').primaryKey(), // disputeId
  subject: integer('subject').notNull(),
  marketId: integer('market_id'),
  target: integer('target'),
  participant: text('participant'),
  opener: text('opener'),
  counter: text('counter'),
  bond: text('bond'),
  status: integer('status').notNull().default(0),
  forOpener: integer('for_opener').notNull().default(0),
  against: integer('against').notNull().default(0),
  createdAt: integer('created_at').notNull().default(0),
});
