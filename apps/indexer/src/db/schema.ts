import { pgTable, text, integer, serial } from 'drizzle-orm/pg-core';

// bigint amounts (USDC base units, block numbers that may exceed 2^53) are stored as TEXT.
// Block numbers stay `integer` (int32) — Arc is at ~46M, well under the 2^31 ceiling.

/** Single-row ingestion cursor: the last fully-indexed block. */
export const cursor = pgTable('cursor', {
  id: text('id').primaryKey(), // always 'head'
  lastBlock: integer('last_block').notNull().default(0),
});

/** Raw decoded log — immutable history, drives the activity feed. */
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
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
export const markets = pgTable('markets', {
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
export const applications = pgTable('applications', {
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
export const findings = pgTable('findings', {
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
export const milestones = pgTable('milestones', {
  id: text('id').primaryKey(), // `${marketId}-${idx}`
  marketId: integer('market_id').notNull(),
  idx: integer('idx').notNull(),
  amount: text('amount'),
  status: integer('status').notNull().default(0),
  deliverableHash: text('deliverable_hash'),
  submittedAt: integer('submitted_at'),
});

/** Mode-A reveal stake holds. status: 0 None, 1 Held, 2 Flagged, 3 Settled. */
export const revealHolds = pgTable('reveal_holds', {
  id: text('id').primaryKey(), // `${marketId}-${participant}`
  marketId: integer('market_id').notNull(),
  participant: text('participant').notNull(),
  status: integer('status').notNull().default(1),
  revealedAt: integer('revealed_at'),
});

/**
 * Per-address reputation rollup, derived from EchoHook events. Two sides in one row:
 *  - provider-side (P-Rep): TierPayout increments jobs_completed, total_earned, tier_sum.
 *  - responsiveness (R-Rep): GhostPenalty (provider ghosted) and RRepSlashed (requester-side)
 *    increment ghost_count / total_slashed / r_rep_slashes.
 * Address keys are stored lowercased so lookups from URL handles match regardless of case.
 * Raw counters only — any decay model layers on top as a computed field, no schema change.
 */
export const reputation = pgTable('reputation', {
  address: text('address').primaryKey(), // lowercased EOA / smart-account address
  agentId: text('agent_id'), // denormalised — populated whenever a related event also carries the agentId
  jobsCompleted: integer('jobs_completed').notNull().default(0),
  totalEarned: text('total_earned').notNull().default('0'), // sum of TierPayout.net (USDC base units, bigint as text)
  tierSum: integer('tier_sum').notNull().default(0), // Σ (tier + 1) — weighted prestige
  ghostCount: integer('ghost_count').notNull().default(0),
  totalSlashed: text('total_slashed').notNull().default('0'), // sum of GhostPenalty.ghostAmount
  rRepSlashes: integer('r_rep_slashes').notNull().default(0), // requester-side RRepSlashed count
  lastEventBlock: integer('last_event_block').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0),
});

/**
 * Off-chain content channel — the text-payload layer the contracts deliberately left to the app
 * ("Content delivery is app-mediated off-chain" — MarketRegistry.sol:458). For demo purposes
 * we store plaintext and gate reads with a wallet signature; production should replace this
 * with E2E encryption (see memory: echo-content-channel-gap).
 *
 * Two kinds carry all content today:
 *  - kind='apply'   key=<participant addr lowercase>  text = the application body (revealed to requester after `reveal`)
 *  - kind='deliver' key=<arc jobId>                  text = per-tier deliverable (visible to provider + evaluator of that job)
 */
export const contents = pgTable('contents', {
  id: text('id').primaryKey(), // `${marketId}-${kind}-${key}`
  marketId: integer('market_id').notNull(),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  author: text('author').notNull(), // wallet that signed the storeContent call (lowercased)
  body: text('body').notNull(),
  hash: text('hash').notNull(), // keccak256(toUtf8Bytes(body)) — UI can match against on-chain commitment
  createdAt: integer('created_at').notNull().default(0),
});

/**
 * One-time SIWE nonces. A client asks for a nonce, signs a SIWE message containing it, and the
 * verify step consumes it (deletes on use) so a captured signature can't be replayed. Rows expire
 * after a few minutes; a sweeper drops stale ones.
 */
export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(), // random 17-char alphanumeric (siwe generateNonce)
  createdAt: integer('created_at').notNull(), // unix seconds
});

/**
 * Server-side sessions minted after a valid SIWE signature. The token is the bearer credential; the
 * address is the *proven* controller (not client-claimed). Content-channel writes/reads verify the
 * caller against this row instead of trusting a claimed address. Bound to the issuing IP so a leaked
 * token can't be replayed from another host.
 */
export const userSessions = pgTable('user_sessions', {
  token: text('token').primaryKey(), // 256-bit random hex
  address: text('address').notNull(), // lowercased, proven via SIWE
  ip: text('ip').notNull(), // client IP the token was issued to
  issuedAt: integer('issued_at').notNull(), // unix seconds
  expiresAt: integer('expires_at').notNull(), // unix seconds
});

/** Disputes (DisputeResolver). subject: 0 BountyFinding, 1 ModeAStake. status: 0 Open, 1 Resolved. */
export const disputes = pgTable('disputes', {
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
