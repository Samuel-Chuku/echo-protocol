export type Address = `0x${string}`;

/**
 * Market on Echo Protocol
 */
export interface Market {
  id: string;
  title: string;
  scopeHash: string;
  metadataURI: string;
  requesterId: string;
  requesterAddress: Address;
  tierPayouts: number[]; // [substantive_cents, shortlist_cents, final_cents, ghost_cents]
  minPRep: number;
  maxApplicants: number;
  ghostDeadline: number; // seconds
  escrowTotal: number; // USDC in cents
  escrowSpent: number; // USDC in cents
  applicantCount: number;
  status: MarketStatus;
  createdAt: string;
  expiresAt?: string;
}

export type MarketStatus = 'active' | 'paused' | 'closed';

/**
 * Application from participant to a market
 */
export interface Application {
  id: string;
  marketId: string;
  participantId: string;
  participantAddress: Address;
  submissionHash: string;
  status: ApplicationStatus;
  tierReached: number;
  totalEarned: number; // USDC in cents
  prTokenId?: string;
  ghostDeadline?: string;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus =
  | 'submitted'
  | 'substantive'
  | 'shortlist'
  | 'final'
  | 'rejected'
  | 'ghosted';

/**
 * Participation Receipt (ERC-721)
 */
export interface ParticipationReceipt {
  tokenId: string;
  marketId: string;
  participant: Address;
  submissionHash: string;
  timestamp: string;
  tierReached: number;
  totalEarned: number;
  withdrawn: boolean;
}

/**
 * Reputation Profile
 */
export interface ReputationProfile {
  agentId: string;
  pRep: number; // 0-10000
  rRep: number;
  gRep: number;
  totalMarkets: number;
  totalEarned: number;
  ghostRate: number;
  avgResponseTime?: number; // hours
  history: ReputationEvent[];
  achievements: string[];
}

export interface ReputationEvent {
  id: string;
  type: 'tier_pass' | 'ghosted' | 'rep_boost' | 'submitted' | 'responded' | 'slashed';
  agentId: string;
  counterpartyId?: string;
  marketId?: string;
  amount?: number;
  tier?: number;
  timestamp: string;
  metadata?: string;
}

/**
 * Grading Action
 */
export interface GradingAction {
  marketId: string;
  participantAddress: Address;
  fromTier: number;
  toTier: number;
  reason?: string;
}

/**
 * Tier definitions
 */
export enum Tier {
  Submitted = 0,
  Substantive = 1,
  Shortlist = 2,
  Final = 3,
  Ghost = 4,
}

export const TIER_WEIGHTS: Record<Tier, number> = {
  [Tier.Submitted]: 10,
  [Tier.Substantive]: 100,
  [Tier.Shortlist]: 500,
  [Tier.Final]: 2000,
  [Tier.Ghost]: -200,
};
