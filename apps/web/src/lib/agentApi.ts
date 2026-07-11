'use client';

// REST client for the indexer's autonomous-agent surface (#4). Mirrors how auth.tsx derives the
// indexer base from the GraphQL URL. Provision/create-market require a SIWE bearer token; reads are
// public.
import { getSessionToken } from './session-token';

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000/graphql';
const API_BASE = INDEXER_URL.replace(/\/graphql\/?$/, '');

export type AgentDecision = {
  id: string; marketId: number; participant: string; stage: string;
  revealScore: number | null; revealReason: string | null;
  advanceMet: number | null; rank: number | null; reason: string | null;
  txHash: string | null; createdAt: number; updatedAt: number;
};

async function authed(path: string, body: unknown): Promise<any> {
  const token = getSessionToken();
  if (!token) throw new Error('Sign in first (SIWE) to use the AI agent.');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `agent request failed (${res.status})`);
  return data;
}

/** Is a market agent-run? Drives the required-preview gate on the apply page. */
export async function getAgentMarket(marketId: number): Promise<{ agentRun: boolean; walletAddress: string | null; enabled: boolean }> {
  const res = await fetch(`${API_BASE}/agent/market/${marketId}`);
  if (!res.ok) return { agentRun: false, walletAddress: null, enabled: false };
  return res.json();
}

/** The agent's per-applicant decision feed for a market. */
export async function getAgentDecisions(marketId: number): Promise<AgentDecision[]> {
  const res = await fetch(`${API_BASE}/agent/decisions?marketId=${marketId}`);
  if (!res.ok) return [];
  return (await res.json()).decisions ?? [];
}

/** Provision a Circle DCW for the signed-in requester. Returns the address to fund. */
export function provisionAgentWallet(): Promise<{ walletId: string; address: string }> {
  return authed('/agent/provision', {});
}

export type CreateAgentMarketInput = {
  walletId: string; walletAddress: string;
  market: {
    subject: string; description: string;
    tierAmounts: [string, string, string, string]; // base units
    escrowTotal: string; maxApplicants: number; ghostDeadline: number;
    minPRep?: number; requiredProofs?: number; stakeRequired?: string; flagWindow?: number; requesterAgentId?: number;
  };
  agent: { revealCriteria: string; advanceGuardrails: string; maxReveals: number; maxAdvances: number; revealThreshold: number };
};

/** Create an agent-run market from the DCW; the server does approve + createMarket + registers it. */
export function createAgentMarket(input: CreateAgentMarketInput): Promise<{ marketId: number; txHash: string }> {
  return authed('/agent/markets', input);
}
