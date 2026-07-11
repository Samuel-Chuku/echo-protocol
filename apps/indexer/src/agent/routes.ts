import { type Express, type Request, type Response } from 'express';
import { encodeFunctionData, keccak256, parseEventLogs, toBytes } from 'viem';
import { buildMetadata } from '@echo/sdk';
import { db } from '../db/client.js';
import { agentMarkets, agentDecisions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { publicClient } from '../chain.js';
import { MarketRegistryABI } from '../abis.js';
import { resolveSession } from '../auth/session.js';
import { bearer } from '../auth/routes.js';
import { provisionAgentWallet, execApproveUsdc, execCallData, waitForTx, agentContracts } from './circle.js';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => res.status(400).json({ error: (e as Error).message ?? 'agent error' }));
};

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

/** Require a proven SIWE session; returns the lowercased proven address or sends 401. */
async function requireAddr(req: Request, res: Response): Promise<string | null> {
  const session = await resolveSession(bearer(req), clientIp(req));
  if (!session) { res.status(401).json({ error: 'sign in first' }); return null; }
  return session.address.toLowerCase();
}

/**
 * Agent REST surface (#4), mounted under /agent:
 *   GET  /agent/market/:id  → { agentRun, walletAddress? }   is this market agent-run? (public — drives apply UI)
 *   GET  /agent/decisions?marketId= → [decisions]            the agent's per-applicant feed (public read)
 *   POST /agent/provision   → { walletId, address }          provision a Circle DCW for the requester (session)
 *   POST /agent/markets     → { marketId, txHash }           create an agent-run market from the DCW (session)
 */
export function mountAgentRoutes(app: Express): void {
  app.get('/agent/market/:id', wrap(async (req, res) => {
    const [row] = await db.select().from(agentMarkets).where(eq(agentMarkets.marketId, Number(req.params.id))).limit(1);
    res.json({ agentRun: !!row, walletAddress: row?.walletAddress ?? null, enabled: row ? row.enabled === 1 : false });
  }));

  app.get('/agent/decisions', wrap(async (req, res) => {
    const marketId = Number(req.query.marketId);
    if (!marketId) throw new Error('marketId required');
    const rows = await db.select().from(agentDecisions).where(eq(agentDecisions.marketId, marketId));
    res.json({ decisions: rows });
  }));

  app.post('/agent/provision', wrap(async (req, res) => {
    if (!(await requireAddr(req, res))) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const addr = await requireAddr(req, res); // reuse (already checked)
    const { walletId, address } = await provisionAgentWallet(addr ?? undefined);
    res.json({ walletId, address });
  }));

  app.post('/agent/markets', wrap(async (req, res) => {
    if (!(await requireAddr(req, res))) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const b = req.body ?? {};
    const walletId = String(b.walletId ?? '');
    const mk = b.market ?? {};
    const ag = b.agent ?? {};
    if (!walletId) throw new Error('walletId required (provision a DCW first)');

    // Tier amounts + escrow are base-unit (6dp) strings from the client.
    const tierAmounts = (mk.tierAmounts as string[]).map((t) => BigInt(t)) as [bigint, bigint, bigint, bigint];
    const escrowTotal = BigInt(mk.escrowTotal);
    const registry = agentContracts.marketRegistry;

    // 1. approve USDC so the registry can pull escrow when the market is created.
    await waitForTx(await execApproveUsdc(walletId, registry, escrowTotal.toString()));

    // 2. createMarketWithMode via raw calldata (nested ModeConfig struct → encode with viem).
    const calldata = encodeFunctionData({
      abi: MarketRegistryABI,
      functionName: 'createMarketWithMode',
      args: [
        buildMetadata({ subject: mk.subject ?? '', description: mk.description ?? '' }),
        keccak256(toBytes(mk.subject || 'agent-market')),
        tierAmounts,
        BigInt(mk.minPRep ?? 0),
        BigInt(mk.maxApplicants ?? 0),
        BigInt(mk.ghostDeadline ?? 0),
        escrowTotal,
        BigInt(mk.requesterAgentId ?? 0),
        {
          mode: 0, // OpenMarket
          requiredProofs: BigInt(mk.requiredProofs ?? 0),
          stakeRequired: BigInt(mk.stakeRequired ?? 0),
          flagWindow: BigInt(mk.flagWindow ?? 0),
        },
      ],
    });
    const txHash = await waitForTx(await execCallData(walletId, registry, calldata));

    // 3. Read the marketId from the MarketCreated event in the receipt.
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const logs = parseEventLogs({ abi: MarketRegistryABI, eventName: 'MarketCreated', logs: receipt.logs });
    const marketId = Number((logs[0]?.args as { marketId?: bigint })?.marketId ?? 0);
    if (!marketId) throw new Error('could not resolve marketId from MarketCreated event');

    // 4. Register the market as agent-run.
    const walletAddress = String(b.walletAddress ?? '');
    await db.insert(agentMarkets).values({
      marketId,
      walletId,
      walletAddress,
      revealCriteria: String(ag.revealCriteria ?? ''),
      advanceGuardrails: String(ag.advanceGuardrails ?? ''),
      maxReveals: Number(ag.maxReveals ?? 10),
      maxAdvances: Number(ag.maxAdvances ?? 5),
      revealThreshold: Number(ag.revealThreshold ?? 60),
      enabled: 1,
      createdAt: Math.floor(Date.now() / 1000),
    }).onConflictDoNothing();

    res.json({ marketId, txHash });
  }));
}
