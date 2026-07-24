import { type Express, type Request, type Response } from 'express';
import { encodeFunctionData, keccak256, parseEventLogs, toBytes } from 'viem';
import { buildMetadata, IDENTITY_ABI } from '@echo/sdk';
import { db } from '../db/client.js';
import { agentMarkets, agentDecisions, agentWallets } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../config.js';
import { publicClient } from '../chain.js';
import { MarketRegistryABI, AgenticCommerceABI } from '../abis.js';
import { resolveSession } from '../auth/session.js';
import { bearer } from '../auth/routes.js';
import { provisionAgentWallet, withdrawUsdc, execApproveUsdc, execRegisterIdentity, execCallData, execReveal, execGradeSubstantive, execGradeShortlist, execGradeFinal, waitForTx, agentContracts } from './circle.js';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => res.status(400).json({ error: (e as Error).message ?? 'agent error' }));
};

/**
 * Tiny TTL cache for the hot public reads (/agent/market/:id, /agent/wallet/:owner) — every market
 * page view hits them, and the answers only change on market-create / first provision. 30s keeps the
 * DB out of the request path without ever being noticeably stale. Bounded: evicts oldest at 500 keys.
 */
const readCache = new Map<string, { at: number; body: unknown }>();
const CACHE_TTL_MS = 30_000;
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.body as T);
  return load().then((body) => {
    if (readCache.size >= 500) readCache.delete(readCache.keys().next().value!);
    readCache.set(key, { at: Date.now(), body });
    return body;
  });
}

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
 * Ensure the DCW owns an ERC-8004 identity and return its agentId. The market registry's _create
 * requires isAuthorizedOrOwner(msg.sender, requesterAgentId) — a fresh DCW with agentId 0 reverts
 * NotAgentOwner (this surfaced as Circle ESTIMATION_ERROR). Registers once, reads the minted tokenId
 * from the register tx's ERC-721 Transfer event, persists it on agent_wallets.
 */
async function ensureAgentIdentity(owner: string, walletId: string, walletAddress: string): Promise<bigint> {
  const [row] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
  if (row?.agentId) return BigInt(row.agentId);

  const txHash = await waitForTx(await execRegisterIdentity(walletId));
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const transfers = parseEventLogs({ abi: IDENTITY_ABI, eventName: 'Transfer', logs: receipt.logs });
  const minted = transfers.find((l) => (l.args as { to?: string }).to?.toLowerCase() === walletAddress.toLowerCase());
  const agentId = (minted?.args as { tokenId?: bigint })?.tokenId;
  if (agentId === undefined) throw new Error('identity registered but could not read agentId from the Transfer event');

  await db.update(agentWallets).set({ agentId: agentId.toString() }).where(eq(agentWallets.owner, owner));
  return agentId;
}

/**
 * Agent REST surface (#4), mounted under /agent:
 *   GET  /agent/market/:id  → { agentRun, walletAddress?, owner?, enabled }   is this market agent-run? (public — drives apply UI)
 *   GET  /agent/decisions?marketId= → [decisions]            the agent's per-applicant feed (public read)
 *   POST /agent/wallet      → { walletId, walletAddress, balance }  get-or-create the requester's persistent agent wallet + balance (session)
 *   POST /agent/withdraw    → { txHash }                     withdraw USDC from the agent wallet to the owner (session)
 *   POST /agent/markets     → { marketId, txHash }           create an agent-run market drawing from the standing balance (session)
 *   POST /agent/market/:id/pause   → { enabled }             owner pauses/resumes the autonomous loop for one market (session)
 *   POST /agent/market/:id/reveal  → { txHash }              owner-signed reveal (DCW signs; falls back to gradeSubstantive on zero-fee markets)
 *   POST /agent/market/:id/advance → { txHash }              owner-signed single-tier advance (1→2, 2→3), gated on the applicant having delivered
 */
export function mountAgentRoutes(app: Express): void {
  app.get('/agent/market/:id', wrap(async (req, res) => {
    const body = await cached(`market:${req.params.id}`, async () => {
      const [row] = await db.select().from(agentMarkets).where(eq(agentMarkets.marketId, Number(req.params.id))).limit(1);
      // Surface the HUMAN owner behind the DCW: on-chain the market's requester is the agent wallet,
      // and the owner link only exists here (agent_wallets). The UI shows the real requestor with it.
      const [w] = row
        ? await db.select().from(agentWallets).where(eq(agentWallets.walletAddress, row.walletAddress)).limit(1)
        : [];
      return {
        agentRun: !!row,
        walletAddress: row?.walletAddress ?? null,
        owner: w?.owner ?? null,
        enabled: row ? row.enabled === 1 : false,
      };
    });
    res.json(body);
  }));

  // Peek at an owner's agent wallet WITHOUT provisioning one (the POST below is get-or-create; a
  // profile page must not mint a Circle DCW for every visitor). Public read — the owner↔wallet link
  // is observable on-chain anyway (deposits flow owner → DCW).
  app.get('/agent/wallet/:owner', wrap(async (req, res) => {
    const owner = String(req.params.owner ?? '').toLowerCase();
    const body = await cached(`wallet:${owner}`, async () => {
      const [w] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
      return { exists: !!w, walletAddress: w?.walletAddress ?? null };
    });
    res.json(body);
  }));

  app.get('/agent/decisions', wrap(async (req, res) => {
    const marketId = Number(req.query.marketId);
    const owner = typeof req.query.owner === 'string' ? req.query.owner.toLowerCase() : '';
    if (marketId) {
      const rows = await db.select().from(agentDecisions).where(eq(agentDecisions.marketId, marketId));
      res.json({ decisions: rows });
      return;
    }
    // owner= → the agent's decisions across ALL of that requester's agent markets (activity page's
    // agent section). Pure DB join: decisions → their market → the owner's wallet. Zero RPC.
    if (owner) {
      const rows = await db.select({ d: agentDecisions }).from(agentDecisions)
        .innerJoin(agentMarkets, eq(agentDecisions.marketId, agentMarkets.marketId))
        .innerJoin(agentWallets, eq(agentMarkets.walletAddress, agentWallets.walletAddress))
        .where(eq(agentWallets.owner, owner));
      res.json({ decisions: rows.map((r) => r.d) });
      return;
    }
    throw new Error('marketId or owner required');
  }));

  // Get-or-create the requester's persistent agent wallet + its live USDC balance. This is the
  // standing "agent account" they deposit into and withdraw from; markets draw from its balance.
  app.post('/agent/wallet', wrap(async (req, res) => {
    const owner = await requireAddr(req, res);
    if (!owner) return;
    if (!config.agentEnabled) throw new Error('agent is disabled on this server');
    const { walletId, walletAddress } = await getOrCreateWallet(owner);
    readCache.delete(`wallet:${owner}`); // a first provision flips the peek answer immediately
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

  /** Session-auth + assert the caller owns agent market :id. Returns the agent_markets row or 401/404s. */
  async function requireMarketOwner(req: Request, res: Response): Promise<typeof agentMarkets.$inferSelect | null> {
    const owner = await requireAddr(req, res);
    if (!owner) return null;
    const marketId = Number(req.params.id);
    const [m] = await db.select().from(agentMarkets).where(eq(agentMarkets.marketId, marketId)).limit(1);
    if (!m) { res.status(404).json({ error: 'not an agent-run market' }); return null; }
    const [w] = await db.select().from(agentWallets).where(eq(agentWallets.walletAddress, m.walletAddress)).limit(1);
    if (!w || w.owner !== owner) { res.status(403).json({ error: 'not the owner of this agent market' }); return null; }
    return m;
  }

  // Pause/resume the autonomous loop for one market. Paused (enabled=0) markets are skipped by the
  // loop's WHERE enabled=1 filter; the owner then drives reveal/advance manually via the routes below.
  app.post('/agent/market/:id/pause', wrap(async (req, res) => {
    const m = await requireMarketOwner(req, res);
    if (!m) return;
    const enabled = req.body?.enabled ? 1 : 0;
    await db.update(agentMarkets).set({ enabled }).where(eq(agentMarkets.marketId, m.marketId));
    readCache.delete(`market:${m.marketId}`);
    res.json({ marketId: m.marketId, enabled: enabled === 1 });
  }));

  // Owner-signed manual actions. The DCW is the on-chain requester (reveal/grade* are onlyRequester),
  // so the owner can't sign these from their own wallet — the server signs from the DCW after proving
  // the SIWE session belongs to the wallet's owner. Simulate first so reverts come back decoded.
  const simulateAsDcw = async (walletAddress: string, functionName: 'reveal' | 'gradeSubstantive' | 'gradeShortlist' | 'gradeFinal', marketId: number, participant: `0x${string}`) => {
    try {
      await publicClient.simulateContract({
        address: agentContracts.marketRegistry,
        abi: MarketRegistryABI,
        functionName,
        args: [BigInt(marketId), participant],
        account: walletAddress as `0x${string}`,
      });
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? 'simulation failed';
      throw new Error(`${functionName} would revert: ${msg}`);
    }
  };

  // Reveal one applicant from the DCW (pays the reveal fee from market escrow). On a zero-fee market
  // reveal() reverts NotRevealMarket, so fall through to gradeSubstantive for the 0→1 step.
  app.post('/agent/market/:id/reveal', wrap(async (req, res) => {
    const m = await requireMarketOwner(req, res);
    if (!m) return;
    const participant = String(req.body?.participant ?? '') as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(participant)) throw new Error('participant address required');
    const fee = await publicClient.readContract({
      address: agentContracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'revealFee',
      args: [BigInt(m.marketId)],
    }).catch(() => 0n) as bigint;
    const fn = fee > 0n ? 'reveal' : 'gradeSubstantive';
    await simulateAsDcw(m.walletAddress, fn, m.marketId, participant);
    const txHash = await waitForTx(await (fn === 'reveal'
      ? execReveal(m.walletId, m.marketId, participant)
      : execGradeSubstantive(m.walletId, m.marketId, participant)));
    res.json({ txHash });
  }));

  // Advance one applicant a single tier (1→2 Shortlist, 2→3 Final) from the DCW. Mirrors the manage
  // page's submission gate server-side: the applicant's LATEST tier job must be Submitted (2) or
  // Completed (3) before they can climb — an applicant who never delivered can't be advanced.
  app.post('/agent/market/:id/advance', wrap(async (req, res) => {
    const m = await requireMarketOwner(req, res);
    if (!m) return;
    const participant = String(req.body?.participant ?? '') as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(participant)) throw new Error('participant address required');

    const app_ = await publicClient.readContract({
      address: agentContracts.marketRegistry,
      abi: MarketRegistryABI,
      functionName: 'getApplication',
      args: [BigInt(m.marketId), participant],
    }) as { tierReached: number; tierJobIds: readonly bigint[] };
    const tier = Number(app_.tierReached);
    if (tier !== 1 && tier !== 2) throw new Error(`applicant is at tier ${tier} — only Revealed (1) or Shortlist (2) applicants can be advanced`);

    // Submission gate: latest tier job (the one for their CURRENT tier) must be delivered.
    const jobIds = app_.tierJobIds ?? [];
    if (jobIds.length > 0) {
      const lastJob = await publicClient.readContract({
        address: agentContracts.agenticCommerce,
        abi: AgenticCommerceABI,
        functionName: 'getJob',
        args: [jobIds[jobIds.length - 1]],
      }).catch(() => null) as { status: number } | null;
      const st = lastJob ? Number(lastJob.status) : null;
      if (st !== null && st !== 2 && st !== 3) {
        throw new Error('the applicant has not submitted their deliverable for the current tier yet — advancing is gated on delivery');
      }
    }

    const fn = tier === 1 ? 'gradeShortlist' : 'gradeFinal';
    await simulateAsDcw(m.walletAddress, fn, m.marketId, participant);
    const txHash = await waitForTx(await (fn === 'gradeShortlist'
      ? execGradeShortlist(m.walletId, m.marketId, participant)
      : execGradeFinal(m.walletId, m.marketId, participant)));
    // Keep the decision feed truthful: record the manual action so the market page's agent feed
    // doesn't keep showing a stale "ranked — needs your review" for someone already advanced.
    await db.update(agentDecisions)
      .set({ stage: 'advanced', reason: 'Advanced manually by the owner.', txHash, updatedAt: Math.floor(Date.now() / 1000) })
      .where(and(eq(agentDecisions.marketId, m.marketId), eq(agentDecisions.participant, participant.toLowerCase())));
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

    // 2. The DCW must own the ERC-8004 identity it claims as requesterAgentId (else NotAgentOwner).
    //    Registers once on first market; cached on agent_wallets thereafter.
    const agentIdentity = await ensureAgentIdentity(owner, walletId, walletAddress);

    // 3. createMarketWithMode via raw calldata (nested ModeConfig struct → encode with viem).
    const createArgs = [
      buildMetadata({ subject: mk.subject ?? '', description: mk.description ?? '' }),
      keccak256(toBytes(mk.subject || 'agent-market')),
      tierAmounts,
      BigInt(mk.minPRep ?? 0),
      BigInt(mk.maxApplicants ?? 0),
      BigInt(mk.ghostDeadline ?? 0),
      escrowTotal,
      agentIdentity,
      {
        mode: 0, // OpenMarket
        requiredProofs: BigInt(mk.requiredProofs ?? 0),
        stakeRequired: BigInt(mk.stakeRequired ?? 0),
        flagWindow: BigInt(mk.flagWindow ?? 0),
      },
    ] as const;

    // Pre-flight: simulate the exact call as the DCW so a would-be revert surfaces as a DECODED
    // reason ("NotAgentOwner", "InsufficientEscrow…") instead of Circle's opaque ESTIMATION_ERROR.
    try {
      await publicClient.simulateContract({
        address: registry,
        abi: MarketRegistryABI,
        functionName: 'createMarketWithMode',
        args: createArgs as unknown as never,
        account: walletAddress as `0x${string}`,
      });
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage
        ?? (e as Error).message ?? 'simulation failed';
      throw new Error(`market creation would revert: ${msg}`);
    }

    const calldata = encodeFunctionData({
      abi: MarketRegistryABI,
      functionName: 'createMarketWithMode',
      args: createArgs as unknown as never,
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
    readCache.delete(`market:${marketId}`); // the create flips agentRun for this id immediately

    res.json({ marketId, txHash });
  }));
}
