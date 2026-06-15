import { gql } from 'urql';
import { short } from './format';

/**
 * Activity feed plumbing shared by the notification bell and the /activity page. Both read the
 * indexer's `activity(address)` query — the wallet's events as actor or as a market's requester,
 * each tagged PENDING (needs someone's action) or COMPLETED by the indexer.
 */
export const ACTIVITY_QUERY = gql`
  query Activity($address: String!, $status: String, $limit: Int) {
    activity(address: $address, status: $status, limit: $limit) {
      id
      blockNumber
      txHash
      eventName
      marketId
      actor
      args
      state
      createdAt
    }
  }
`;

export type ActivityRow = {
  id: number;
  blockNumber: number;
  txHash: string;
  eventName: string;
  marketId: number | null;
  actor: string | null;
  args: string;
  state: 'PENDING' | 'COMPLETED';
  createdAt: number;
};

/** Plain-English label for an indexer event name. Falls back to the raw name for anything new. */
const EVENT_LABELS: Record<string, string> = {
  MarketCreated: 'Market created',
  BountyCreated: 'Bounty created',
  DirectJobCreated: 'Direct job created',
  Applied: 'New application',
  Revealed: 'Applicant revealed',
  TierAdvanced: 'Applicant advanced',
  MilestoneSubmitted: 'Milestone submitted',
  MilestoneReleased: 'Milestone paid',
  DirectJobCancelled: 'Direct job cancelled',
  FindingSubmitted: 'Finding submitted',
  FindingAccepted: 'Finding accepted',
  FindingRejected: 'Finding rejected',
  FindingDisputed: 'Finding disputed',
  FindingDisputeResolved: 'Finding dispute resolved',
  BountyClosed: 'Bounty closed',
  MarketClosed: 'Market closed',
  RevealFlagged: 'Reveal flagged',
  RevealStakeReturned: 'Reveal stake returned',
  RevealStakeResolved: 'Reveal stake resolved',
  DisputeOpened: 'Dispute opened',
  DisputeCountered: 'Dispute countered',
  Voted: 'Juror voted',
  DisputeResolved: 'Dispute resolved',
};
export const eventLabel = (name: string) => EVENT_LABELS[name] ?? name;

/** A compact one-line context string from an event's decoded args JSON. */
export function summarizeArgs(json: string): string {
  let args: Record<string, unknown>;
  try { args = JSON.parse(json); } catch { return ''; }
  const parts: string[] = [];
  for (const k of ['index', 'toTier', 'award', 'amount', 'bond']) {
    if (args[k] !== undefined) parts.push(`${k} ${String(args[k])}`);
  }
  for (const k of ['participant', 'submitter', 'worker', 'opener']) {
    if (typeof args[k] === 'string') parts.push(short(args[k] as string));
  }
  return parts.slice(0, 2).join(' · ');
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" from a unix-seconds timestamp. */
export function timeAgo(unixSecs: number, now: number): string {
  const s = Math.max(0, now - unixSecs);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
