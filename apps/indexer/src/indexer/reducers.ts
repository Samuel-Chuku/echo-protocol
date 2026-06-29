import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { markets, applications, findings, milestones, revealHolds, disputes, reputation } from '../db/schema.js';
import { publicClient } from '../chain.js';
import { MarketRegistryABI } from '../abis.js';
import { config } from '../config.js';

const reg = { address: config.contracts.marketRegistry as `0x${string}`, abi: MarketRegistryABI } as const;
const readReg = (functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ ...reg, functionName, args } as never) as Promise<any>;

/** metadataURI carries `{subject, description}` JSON (the console writes it). Parse defensively. */
function parseMetadata(uri: unknown): { subject?: string; description?: string } {
  if (typeof uri !== 'string' || !uri) return {};
  try {
    const raw = uri.startsWith('data:') ? decodeURIComponent(uri.slice(uri.indexOf(',') + 1)) : uri;
    const j = JSON.parse(raw);
    return { subject: j.subject, description: j.description };
  } catch {
    return {};
  }
}

const s = (v: unknown) => (v === undefined || v === null ? null : String(v));
type Ctx = { block: number; now: number };

/** Apply one decoded log to the derived tables. Returns {marketId, actor} for the raw events row. */
export async function applyEvent(
  eventName: string,
  args: Record<string, any>,
  ctx: Ctx,
): Promise<{ marketId: number | null; actor: string | null }> {
  const mid = args.marketId !== undefined ? Number(args.marketId) : null;

  switch (eventName) {
    case 'MarketCreated': {
      const id = Number(args.marketId);
      const [m, mode, revealFee, flagWindow, stake] = await Promise.all([
        readReg('getMarket', [BigInt(id)]),
        readReg('marketMode', [BigInt(id)]),
        readReg('revealFee', [BigInt(id)]).catch(() => 0n),
        readReg('revealFlagWindow', [BigInt(id)]).catch(() => 0n),
        readReg('marketStakeRequired', [BigInt(id)]).catch(() => 0n),
      ]);
      const meta = parseMetadata(m.metadataURI);
      await db.insert(markets).values({
        id, mode: Number(mode), requester: m.requester, requesterAgentId: s(m.requesterAgentId),
        subject: meta.subject ?? null, description: meta.description ?? null, metadataURI: s(m.metadataURI),
        scopeHash: s(m.scopeHash), tiers: JSON.stringify((m.tierAmounts ?? []).map(String)),
        escrowTotal: s(m.escrowTotal), revealFee: s(revealFee), flagWindow: Number(flagWindow),
        ghostDeadline: Number(m.ghostDeadline ?? 0),
        stakeRequired: s(stake), status: m.closed ? 'closed' : 'active',
        applicantCount: Number(m.applicantCount ?? 0), createdAtBlock: ctx.block, createdAt: ctx.now,
      }).onConflictDoNothing();
      return { marketId: id, actor: m.requester };
    }

    case 'BountyCreated': {
      const id = Number(args.marketId);
      const b = await readReg('bounties', [BigInt(id)]);
      const meta = parseMetadata(b.metadataURI);
      await db.insert(markets).values({
        id, mode: 2, requester: args.requester, requesterAgentId: s(b.requesterAgentId),
        subject: meta.subject ?? null, description: meta.description ?? null, metadataURI: s(b.metadataURI),
        scopeHash: s(b.scopeHash), pool: s(args.pool), defaultAward: s(args.defaultAward),
        reviewWindow: Number(b.reviewWindow ?? 0), escrowTotal: s(args.pool),
        createdAtBlock: ctx.block, createdAt: ctx.now,
      }).onConflictDoNothing();
      return { marketId: id, actor: args.requester };
    }

    case 'DirectJobCreated': {
      const id = Number(args.marketId);
      const j = await readReg('directJobs', [BigInt(id)]);
      const ms = (await readReg('getDirectJobMilestones', [BigInt(id)]).catch(() => [])) as any[];
      const meta = parseMetadata(j.metadataURI);
      await db.insert(markets).values({
        id, mode: 1, requester: args.requester, worker: args.worker, requesterAgentId: s(j.requesterAgentId),
        subject: meta.subject ?? null, description: meta.description ?? null, metadataURI: s(j.metadataURI),
        scopeHash: s(j.scopeHash), reviewWindow: Number(j.reviewWindow ?? 0), escrowTotal: s(args.total),
        createdAtBlock: ctx.block, createdAt: ctx.now,
      }).onConflictDoNothing();
      for (let i = 0; i < ms.length; i++) {
        await db.insert(milestones).values({
          id: `${id}-${i}`, marketId: id, idx: i, amount: s(ms[i].amount), status: Number(ms[i].status ?? 0),
        }).onConflictDoNothing();
      }
      return { marketId: id, actor: args.worker };
    }

    case 'Applied': {
      const id = Number(args.marketId);
      await db.insert(applications).values({
        id: `${id}-${args.participant}`, marketId: id, participant: args.participant,
        receiptId: s(args.receiptTokenId), submissionHash: s(args.submissionHash), createdAt: ctx.now,
      }).onConflictDoNothing();
      // Recompute (not increment) so re-processing a range after a crash can't double-count.
      const [cnt] = await db.select({ c: sql<number>`count(*)` }).from(applications).where(eq(applications.marketId, id)).limit(1);
      await db.update(markets).set({ applicantCount: Number(cnt?.c ?? 0) }).where(eq(markets.id, id));
      return { marketId: id, actor: args.participant };
    }

    case 'Revealed': {
      const id = Number(args.marketId);
      await db.update(applications).set({ status: 'revealed', tierReached: 1 })
        .where(eq(applications.id, `${id}-${args.participant}`));
      await db.insert(revealHolds).values({
        id: `${id}-${args.participant}`, marketId: id, participant: args.participant, status: 1, revealedAt: ctx.now,
      }).onConflictDoUpdate({ target: revealHolds.id, set: { status: 1, revealedAt: ctx.now } });
      return { marketId: id, actor: args.participant };
    }

    case 'TierAdvanced': {
      const id = Number(args.marketId);
      const to = Number(args.toTier);
      const status = to >= 3 ? 'final' : to === 2 ? 'shortlist' : 'revealed';
      await db.update(applications).set({ tierReached: to, status })
        .where(eq(applications.id, `${id}-${args.participant}`));
      return { marketId: id, actor: args.participant };
    }

    case 'MilestoneSubmitted':
      await db.update(milestones).set({ status: 1, deliverableHash: s(args.deliverableHash), submittedAt: ctx.now })
        .where(eq(milestones.id, `${mid}-${Number(args.index)}`));
      return { marketId: mid, actor: null };

    case 'MilestoneReleased':
      await db.update(milestones).set({ status: 2 }).where(eq(milestones.id, `${mid}-${Number(args.index)}`));
      return { marketId: mid, actor: null };

    case 'DirectJobCancelled':
      await db.update(markets).set({ status: 'cancelled' }).where(eq(markets.id, Number(mid)));
      return { marketId: mid, actor: null };

    case 'FindingSubmitted': {
      const id = Number(args.marketId);
      await db.insert(findings).values({
        id: `${id}-${Number(args.index)}`, marketId: id, idx: Number(args.index), submitter: args.submitter,
        findingHash: s(args.findingHash), status: 0, createdAt: ctx.now,
      }).onConflictDoNothing();
      return { marketId: id, actor: args.submitter };
    }

    case 'FindingAccepted': {
      const id = Number(args.marketId);
      await db.update(findings).set({ status: 1, award: s(args.award) }).where(eq(findings.id, `${id}-${Number(args.index)}`));
      return { marketId: id, actor: await findingSubmitter(id, Number(args.index)) };
    }
    case 'FindingRejected': {
      const id = Number(args.marketId);
      await db.update(findings).set({ status: 2 }).where(eq(findings.id, `${id}-${Number(args.index)}`));
      return { marketId: id, actor: await findingSubmitter(id, Number(args.index)) };
    }
    case 'FindingDisputed': {
      const id = Number(args.marketId);
      await db.update(findings).set({ status: 3 }).where(eq(findings.id, `${id}-${Number(args.index)}`));
      return { marketId: id, actor: await findingSubmitter(id, Number(args.index)) };
    }
    case 'FindingDisputeResolved': {
      const id = Number(args.marketId);
      await db.update(findings).set({ status: args.findingValid ? 1 : 2, award: s(args.award) })
        .where(eq(findings.id, `${id}-${Number(args.index)}`));
      return { marketId: id, actor: await findingSubmitter(id, Number(args.index)) };
    }

    case 'BountyClosed':
    case 'MarketClosed':
      await db.update(markets).set({ status: 'closed' }).where(eq(markets.id, Number(mid)));
      return { marketId: mid, actor: null };

    case 'RevealFlagged':
      await db.update(revealHolds).set({ status: 2 }).where(eq(revealHolds.id, `${mid}-${args.participant}`));
      return { marketId: mid, actor: args.participant };
    case 'RevealStakeReturned':
    case 'RevealStakeResolved':
      await db.update(revealHolds).set({ status: 3 }).where(eq(revealHolds.id, `${mid}-${args.participant}`));
      return { marketId: mid, actor: args.participant ?? null };

    // ── DisputeResolver ──
    case 'DisputeOpened':
      await db.insert(disputes).values({
        id: Number(args.disputeId), subject: Number(args.subject), marketId: Number(args.marketId),
        target: Number(args.target), opener: args.opener, bond: s(args.bond), status: 0, createdAt: ctx.now,
      }).onConflictDoNothing();
      return { marketId: Number(args.marketId), actor: args.opener };
    case 'DisputeCountered':
      await db.update(disputes).set({ counter: args.counter }).where(eq(disputes.id, Number(args.disputeId)));
      return { marketId: null, actor: args.counter };
    case 'Voted':
      await db.update(disputes).set(args.forOpener
        ? { forOpener: sql`${disputes.forOpener} + 1` } : { against: sql`${disputes.against} + 1` })
        .where(eq(disputes.id, Number(args.disputeId)));
      return { marketId: null, actor: args.juror };
    case 'DisputeResolved':
      await db.update(disputes).set({ status: 1, forOpener: Number(args.forOpener), against: Number(args.against) })
        .where(eq(disputes.id, Number(args.disputeId)));
      return { marketId: null, actor: null };

    // ── Worker-recourse tier-job dispute ──
    // No dedicated MarketRegistry events (kept off the registry for EIP-170): the dispute row is
    // created/updated by the generic Dispute* cases above (subject = 2, target = jobId), and the
    // money/outcome surfaces via EchoHook's DisputedTierSettled below.

    // ── EchoHook (settlement + reputation) ──
    case 'TierPayout': {
      // Provider got paid at tier T (0 reveal, 1 shortlist, 2 final). Bump P-Rep totals.
      const provider = String(args.participant).toLowerCase();
      const net = String(args.amount ?? '0');
      const tier = Number(args.tier ?? 0);
      await upsertReputation(provider, ctx, {
        jobsCompleted: 1,
        totalEarnedDelta: net,
        tierSumDelta: tier + 1,
      });
      return { marketId: mid, actor: provider };
    }

    case 'GhostPenalty': {
      // REQUESTER-ghost path: worker submitted but requester never accepted before the deadline.
      // The worker got paid the ghost reserve as compensation — it's a positive cash signal for
      // them (totalEarned bump), NOT a slash. Requester-side slash is handled by RRepSlashed.
      // (Older builds incorrectly incremented the worker's ghost_count here; if you see
      // pre-2026-06-24 rollups skewed, drop the reputation table and re-index from cursor=0.)
      const provider = String(args.participant).toLowerCase();
      const amount = String(args.amount ?? '0');
      await upsertReputation(provider, ctx, {
        totalEarnedDelta: amount,
      });
      return { marketId: mid, actor: provider };
    }

    case 'WorkerGhosted': {
      // WORKER-ghost path: applicant graded to Final never submitted before the deadline. No
      // payouts moved. The worker's ghost_count is the right slot for this — it now exclusively
      // tracks "times the worker no-showed at Final" rather than the legacy conflated signal.
      const participant = String(args.participant).toLowerCase();
      const agentId = args.participantAgentId !== undefined ? String(args.participantAgentId) : undefined;
      await upsertReputation(participant, ctx, {
        ghostCountDelta: 1,
        agentId,
      });
      return { marketId: mid, actor: participant };
    }

    case 'DisputedTierSettled': {
      // A Final-tier rejection dispute settled. On a worker win the worker was PAID via the normal
      // settlement leg, so the `TierPayout` fired alongside this already bumped P-Rep — do NOT credit
      // again here. This case only attributes the activity-feed row to the worker.
      const worker = args.worker ? String(args.worker).toLowerCase() : null;
      return { marketId: mid, actor: worker };
    }

    case 'RRepSlashed': {
      // Requester-side R-Rep slash. Event carries only agentId; look up the address via the
      // earliest market we indexed for that requester.
      const agentId = String(args.requesterAgentId);
      const [m] = await db.select({ requester: markets.requester })
        .from(markets).where(eq(markets.requesterAgentId, agentId)).limit(1);
      if (!m) return { marketId: mid, actor: null }; // unknown agentId — ignore
      const requester = m.requester.toLowerCase();
      await upsertReputation(requester, ctx, { rRepSlashesDelta: 1, agentId });
      return { marketId: mid, actor: requester };
    }

    default:
      return { marketId: mid, actor: null };
  }
}

type RepDelta = {
  jobsCompleted?: number;
  totalEarnedDelta?: string; // bigint as decimal string
  tierSumDelta?: number;
  ghostCountDelta?: number;
  totalSlashedDelta?: string;
  rRepSlashesDelta?: number;
  agentId?: string;
};

/**
 * Atomic upsert into the reputation rollup. We rely on Postgres `ON CONFLICT DO UPDATE` so the
 * increments happen in one round-trip with no read-modify-write race. bigint columns (total_earned,
 * total_slashed) are stored as TEXT and added with `(col::numeric + $delta::numeric)::text`.
 */
async function upsertReputation(address: string, ctx: Ctx, d: RepDelta): Promise<void> {
  const insert = {
    address,
    agentId: d.agentId ?? null,
    jobsCompleted: d.jobsCompleted ?? 0,
    totalEarned: d.totalEarnedDelta ?? '0',
    tierSum: d.tierSumDelta ?? 0,
    ghostCount: d.ghostCountDelta ?? 0,
    totalSlashed: d.totalSlashedDelta ?? '0',
    rRepSlashes: d.rRepSlashesDelta ?? 0,
    lastEventBlock: ctx.block,
    updatedAt: ctx.now,
  };
  await db.insert(reputation).values(insert).onConflictDoUpdate({
    target: reputation.address,
    set: {
      agentId: sql`COALESCE(${reputation.agentId}, EXCLUDED.agent_id)`,
      jobsCompleted: sql`${reputation.jobsCompleted} + EXCLUDED.jobs_completed`,
      totalEarned: sql`(${reputation.totalEarned}::numeric + EXCLUDED.total_earned::numeric)::text`,
      tierSum: sql`${reputation.tierSum} + EXCLUDED.tier_sum`,
      ghostCount: sql`${reputation.ghostCount} + EXCLUDED.ghost_count`,
      totalSlashed: sql`(${reputation.totalSlashed}::numeric + EXCLUDED.total_slashed::numeric)::text`,
      rRepSlashes: sql`${reputation.rRepSlashes} + EXCLUDED.r_rep_slashes`,
      lastEventBlock: sql`GREATEST(${reputation.lastEventBlock}, EXCLUDED.last_event_block)`,
      updatedAt: sql`EXCLUDED.updated_at`,
    },
  });
}

async function findingSubmitter(marketId: number, idx: number): Promise<string | null> {
  const [row] = await db.select({ submitter: findings.submitter }).from(findings)
    .where(eq(findings.id, `${marketId}-${idx}`)).limit(1);
  return row?.submitter ?? null;
}
