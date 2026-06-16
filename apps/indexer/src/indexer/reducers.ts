import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { markets, applications, findings, milestones, revealHolds, disputes } from '../db/schema.js';
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
      const cnt = await db.select({ c: sql<number>`count(*)` }).from(applications).where(eq(applications.marketId, id)).get();
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

    default:
      return { marketId: mid, actor: null };
  }
}

async function findingSubmitter(marketId: number, idx: number): Promise<string | null> {
  const row = await db.select({ submitter: findings.submitter }).from(findings)
    .where(eq(findings.id, `${marketId}-${idx}`)).get();
  return row?.submitter ?? null;
}
