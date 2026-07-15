import { type Express, type Request, type Response } from 'express';
import { encodeFunctionData, keccak256, parseEventLogs, toBytes } from 'viem';
import { buildMetadata } from '@echo/sdk';
import { db } from '../db/client.js';
import { agentMarkets, agentDecisions, agentWallets } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { publicClient } from '../chain.js';
import { MarketRegistryABI } from '../abis.js';
import { resolveSession } from '../auth/session.js';
import { bearer } from '../auth/routes.js';
import { provisionAgentWallet, withdrawUsdc, execApproveUsdc, execCallData, waitForTx, agentContracts } from './circle.js';

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

/** Get the requester's persistent agent wallet, provisioning one on first use. Keyed by owner addr. */
async function getOrCreateWallet(owner: string): Promise<{ walletId: string; walletAddress: string }> {
  const [existing] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
  if (existing) return { walletId: existing.walletId, walletAddress: existing.walletAddress };
  const { walletId, address } = await provisionAgentWallet(owner);
  await db.insert(agentWallets).values({ owner, walletId, walletAddress: address, createdAt: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();
  // Re-read in case of a race (another request created it first).
  const [row] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
  return { walletId: row!.walletId, walletAddress: row!.walletAddress };
}

/**
 * Agent REST surface (#4), mounted under /agent:
 *   GET  /agent/market/:id  → { agentRun, walletAddress? }   is this market agent-run? (public — drives apply UI)
 *   GET  /agent/decisions?marketId= → [decisions]            the agent's per-applicant feed (public read)
 *   POST /agent/wallet      → { walletId, walletAddress, balance }  get-or-create the requester's persistent agent wallet + balance (session)
 *   POST /agent/withdraw    → { txHash }                     withdraw USDC from the agent wallet to the owner (session)
 *   POST /agent/markets     → { marketId, txHash }           create an agent-run market drawing from the standing balance (session)
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

  // Get-or-create the requester's persistent agent wallet + its live USDC balance. This is the
  // standing "agent account" they deposit into and withdraw from; markets draw from its balance.
  app.post('/agent/wallet', wrap(async (req, res) => {
    const owner = await requireAddr(req, res);
    if (!owner) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const { walletId, walletAddress } = await getOrCreateWallet(owner);
    // Balance read on-chain (Circle's balance API lags fresh deposits). Clients poll on-chain too.
    const bal = await publicClient.readContract({
      address: agentContracts.usdc,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    }).catch(() => 0n) as bigint;
    res.json({ walletId, walletAddress, balance: (Number(bal) / 1e6).toString() });
  }));

  // Withdraw USDC from the agent wallet back to the owner's address (defund). Amount in decimal USDC.
  app.post('/agent/withdraw', wrap(async (req, res) => {
    const owner = await requireAddr(req, res);
    if (!owner) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const amount = String(req.body?.amount ?? '').trim();
    if (!amount || Number(amount) <= 0) throw new Error('positive amount required');
    const [wallet] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
    if (!wallet) throw new Error('no agent wallet to withdraw from');
    // Always send back to the OWNER (the signed-in requester) — never a client-supplied destination.
    const txHash = await waitForTx(await withdrawUsdc(wallet.walletId, owner, amount));
    res.json({ txHash });
  }));

  app.post('/agent/markets', wrap(async (req, res) => {
    const owner = await requireAddr(req, res);
    if (!owner) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const b = req.body ?? {};
    const mk = b.market ?? {};
    const ag = b.agent ?? {};

    // The market is created from the requester's PERSISTENT agent wallet (funded via deposit already),
    // not a per-request walletId. Draws escrow from its standing balance — no per-market funding hop.
    const { walletId, walletAddress } = await getOrCreateWallet(owner);

    // Tier amounts + escrow are base-unit (6dp) strings from the client.
    const tierAmounts = (mk.tierAmounts as string[]).map((t) => BigInt(t)) as [bigint, bigint, bigint, bigint];
    const escrowTotal = BigInt(mk.escrowTotal);
    const registry = agentContracts.marketRegistry;

    // Pre-flight: the agent wallet must already hold enough USDC (deposited beforehand) to fund escrow.
    // Read the balance ON-CHAIN — Circle's monitored-token balance API lags fresh funding and can
    // false-negative right after a deposit.
    const balUnits = await publicClient.readContract({
      address: agentContracts.usdc,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    }) as bigint;
    if (balUnits < escrowTotal) {
      throw new Error(`agent wallet balance ${(Number(balUnits) / 1e6).toFixed(2)} USDC is below the ${(Number(escrowTotal) / 1e6).toFixed(2)} USDC escrow — deposit more first`);
    }

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
