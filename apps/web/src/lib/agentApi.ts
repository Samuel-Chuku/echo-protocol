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

/** Is a market agent-run? Drives the required-preview gate on the apply page. `owner` is the human
 *  requester behind the DCW (the on-chain requester IS the agent wallet; the link lives off-chain). */
export async function getAgentMarket(marketId: number): Promise<{ agentRun: boolean; walletAddress: string | null; owner: string | null; enabled: boolean }> {
  const res = await fetch(`${API_BASE}/agent/market/${marketId}`);
  if (!res.ok) return { agentRun: false, walletAddress: null, owner: null, enabled: false };
  return res.json();
}

/** The agent's per-applicant decision feed for a market. */
export async function getAgentDecisions(marketId: number): Promise<AgentDecision[]> {
  const res = await fetch(`${API_BASE}/agent/decisions?marketId=${marketId}`);
  if (!res.ok) return [];
  return (await res.json()).decisions ?? [];
}

/** All agent decisions across every agent market owned by `owner` — the activity page's agent feed. */
export async function getOwnerAgentDecisions(owner: string): Promise<AgentDecision[]> {
  const res = await fetch(`${API_BASE}/agent/decisions?owner=${encodeURIComponent(owner.toLowerCase())}`);
  if (!res.ok) return [];
  return (await res.json()).decisions ?? [];
}

/** Does `owner` already have an agent wallet? Read-only — never provisions (unlike getAgentWallet). */
export async function peekAgentWallet(owner: string): Promise<{ exists: boolean; walletAddress: string | null }> {
  const res = await fetch(`${API_BASE}/agent/wallet/${encodeURIComponent(owner.toLowerCase())}`);
  if (!res.ok) return { exists: false, walletAddress: null };
  return res.json();
}

/** Get-or-create the signed-in requester's persistent agent wallet + its live USDC balance. */
export function getAgentWallet(): Promise<{ walletId: string; walletAddress: string; balance: string }> {
  return authed('/agent/wallet', {});
}

/** Withdraw USDC from the agent wallet back to the owner. Amount in decimal USDC (e.g. "12.5"). */
export function withdrawAgent(amount: string): Promise<{ txHash: string }> {
  return authed('/agent/withdraw', { amount });
}

export type CreateAgentMarketInput = {
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

/** Owner pauses/resumes the autonomous loop for one market (enabled flag). */
export function pauseAgentMarket(marketId: number, enabled: boolean): Promise<{ marketId: number; enabled: boolean }> {
  return authed(`/agent/market/${marketId}/pause`, { enabled });
}

/** Owner-signed reveal: the server signs reveal() (or gradeSubstantive on zero-fee markets) from the DCW. */
export function agentReveal(marketId: number, participant: string): Promise<{ txHash: string }> {
  return authed(`/agent/market/${marketId}/reveal`, { participant });
}

/** Owner-signed single-tier advance (1→2 Shortlist, 2→3 Final), gated server-side on the applicant
 *  having submitted their current tier's deliverable. */
export function agentAdvance(marketId: number, participant: string): Promise<{ txHash: string }> {
  return authed(`/agent/market/${marketId}/advance`, { participant });
}
