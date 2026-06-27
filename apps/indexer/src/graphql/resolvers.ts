import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { keccak256, toBytes, type Address } from 'viem';
import { AgenticCommerceABI, CONTRACTS } from '@echo/sdk';
import { db } from '../db/client.js';
import { markets, applications, findings, milestones, disputes, events, cursor, reputation, contents } from '../db/schema.js';
import { publicClient } from '../chain.js';

const C = CONTRACTS.arcTestnet;

// Demo simplification: we trust the client-claimed viewer/author address. Role gating against
// on-chain state still runs (apply → key match, deliver → provider match, reveal-gate for reads)
// but a malicious client could spoof their address and read other people's bodies. Acceptable for
// testnet; replace with E2E encryption before mainnet. See memory: echo-content-channel-gap.

// Per-event lifecycle tag for the pending/completed split in the activity feed.
const PENDING = new Set([
  'Applied', 'FindingSubmitted', 'MilestoneSubmitted', 'DisputeOpened', 'DisputeCountered', 'Voted', 'RevealFlagged',
]);
const stateOf = (name: string) => (PENDING.has(name) ? 'PENDING' : 'COMPLETED');

const marketOut = (m: any) => ({ ...m, tiers: m.tiers ? JSON.parse(m.tiers) : null });

export const resolvers = {
  Query: {
    markets: async (_: unknown, a: { mode?: number; status?: string; requester?: string; openOnly?: boolean; limit?: number }) => {
      const conds = [];
      if (a.mode !== undefined && a.mode !== null) conds.push(eq(markets.mode, a.mode));
      if (a.status) conds.push(eq(markets.status, a.status));
      if (a.openOnly) conds.push(eq(markets.status, 'active'));
      // Address columns aren't normalised on insert (events stay as viem returns them, which is
      // EIP-55 checksum), so compare case-insensitively here — otherwise My Markets misses every
      // row when the wallet returns a different case than the indexer stored.
      if (a.requester) conds.push(sql`LOWER(${markets.requester}) = ${a.requester.toLowerCase()}`);
      const rows = await db.select().from(markets)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(markets.id)).limit(a.limit ?? 100);
      return rows.map(marketOut);
    },
    market: async (_: unknown, a: { id: number }) => {
      const [m] = await db.select().from(markets).where(eq(markets.id, a.id)).limit(1);
      return m ? marketOut(m) : null;
    },
    marketApplications: (_: unknown, a: { marketId: number }) =>
      db.select().from(applications).where(eq(applications.marketId, a.marketId)),
    applications: (_: unknown, a: { participant: string }) =>
      db.select().from(applications).where(eq(applications.participant, a.participant)).orderBy(desc(applications.createdAt)),
    findings: (_: unknown, a: { marketId: number }) =>
      db.select().from(findings).where(eq(findings.marketId, a.marketId)).orderBy(findings.idx),
    milestones: (_: unknown, a: { marketId: number }) =>
      db.select().from(milestones).where(eq(milestones.marketId, a.marketId)).orderBy(milestones.idx),

    activity: async (_: unknown, a: { address: string; status?: string; limit?: number }) => {
      const addr = a.address.toLowerCase();
      // events where the wallet is the actor OR owns the market (requester-side). Case-insensitive
      // requester match — markets.requester is stored in whatever case viem returned (checksum).
      const mine = await db.select({ id: markets.id }).from(markets)
        .where(sql`LOWER(${markets.requester}) = ${addr}`);
      const ids = mine.map((r) => r.id);
      const ownership = ids.length ? or(eq(events.actor, addr), inArray(events.marketId, ids)) : eq(events.actor, addr);
      const rows = await db.select().from(events).where(ownership)
        .orderBy(desc(events.blockNumber), desc(events.logIndex)).limit(a.limit ?? 100);
      return rows
        .map((e) => ({ ...e, state: stateOf(e.eventName) }))
        .filter((e) => !a.status || e.state === a.status);
    },

    marketActivity: async (_: unknown, a: { marketId: number; limit?: number }) => {
      // Oldest-first for the timeline UI; the page reads it as a linear progression.
      const rows = await db.select().from(events).where(eq(events.marketId, a.marketId))
        .orderBy(events.blockNumber, events.logIndex).limit(a.limit ?? 200);
      return rows.map((e) => ({ ...e, state: stateOf(e.eventName) }));
    },

    disputes: (_: unknown, a: { status?: number }) =>
      db.select().from(disputes)
        .where(a.status !== undefined && a.status !== null ? eq(disputes.status, a.status) : undefined)
        .orderBy(desc(disputes.id)),

    reputation: async (_: unknown, a: { address: string }) => {
      // Stored lowercased so /u/{handle} works regardless of caller casing.
      const [row] = await db.select().from(reputation)
        .where(eq(reputation.address, a.address.toLowerCase())).limit(1);
      return row ?? null;
    },

    content: async (
      _: unknown,
      a: { marketId: number; kind: string; key: string; viewer: string },
    ) => {
      if (!a.viewer) throw new Error('viewer required');
      const viewer = a.viewer.toLowerCase();
      const key = a.key.toLowerCase();
      const id = `${a.marketId}-${a.kind}-${key}`;
      const [row] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
      if (!row) return null;

      // Role gating against on-chain / indexed state. Apply: participant always; requester only
      // after a `Revealed` event lifts the application's tierReached to ≥ 1. Deliver: keyed by
      // Arc jobId — provider or evaluator only (looked up live from AgenticCommerce).
      if (a.kind === 'apply') {
        const [m] = await db.select().from(markets).where(eq(markets.id, a.marketId)).limit(1);
        if (!m) throw new Error('Market not found');
        const isParticipant = viewer === key;
        const isRequester = viewer === m.requester.toLowerCase();
        if (!isParticipant && !isRequester) throw new Error('Forbidden');
        if (isRequester) {
          // `key` is lowercased above, but applications.id is built from the checksummed
          // participant address in the Applied reducer — match on lower(participant) so the
          // reveal gate doesn't false-negative on address casing.
          const [app] = await db.select().from(applications)
            .where(and(eq(applications.marketId, a.marketId), eq(sql`lower(${applications.participant})`, key)))
            .limit(1);
          if (!app || app.tierReached < 1) throw new Error('Reveal required');
        }
      } else if (a.kind === 'deliver' || a.kind === 'reject') {
        // Both are keyed by Arc jobId and visible to the two parties on the job: the provider
        // (worker) and the evaluator (requester). A reject reason is written by the requester so
        // the worker learns *why* — so the worker especially must be able to read it.
        const job = await publicClient.readContract({
          address: C.agenticCommerce, abi: AgenticCommerceABI,
          functionName: 'getJob', args: [BigInt(a.key)],
        }) as { provider: Address; evaluator: Address };
        const allowed = [job.provider.toLowerCase(), job.evaluator.toLowerCase()];
        if (!allowed.includes(viewer)) throw new Error('Forbidden');
      } else {
        throw new Error('Unknown content kind');
      }
      return row;
    },

    health: async () => {
      const [cur] = await db.select().from(cursor).where(eq(cursor.id, 'head')).limit(1);
      const lastBlock = cur?.lastBlock ?? 0;
      let headBlock = lastBlock;
      try { headBlock = Number(await publicClient.getBlockNumber()); } catch { /* offline */ }
      const [mCount] = await db.select({ c: sql<number>`count(*)` }).from(markets);
      const [eCount] = await db.select({ c: sql<number>`count(*)` }).from(events);
      return {
        lastBlock, headBlock, lagBlocks: Math.max(0, headBlock - lastBlock),
        markets: Number(mCount?.c ?? 0), events: Number(eCount?.c ?? 0),
      };
    },
  },

  Mutation: {
    storeContent: async (
      _: unknown,
      a: { marketId: number; kind: string; key: string; body: string; author: string },
    ) => {
      if (!a.author) throw new Error('author required');
      if (!['apply', 'deliver', 'reject'].includes(a.kind)) throw new Error('Unknown content kind');

      const author = a.author.toLowerCase();
      const key = a.key.toLowerCase();
      const id = `${a.marketId}-${a.kind}-${key}`;
      const hash = keccak256(toBytes(a.body));
      const createdAt = Math.floor(Date.now() / 1000);

      // Authorship gate against on-chain state. Apply: author must equal the participant address
      // (which the UI uses as `key`). Deliver: author must equal the Arc job's provider (worker).
      // Reject: author must equal the job's evaluator (the requester — the only party who can call
      // reject on chain). Demo simplification: we don't cryptographically prove the caller IS author.
      if (a.kind === 'apply') {
        if (author !== key) throw new Error('apply content: author must equal the participant address');
      } else {
        const job = await publicClient.readContract({
          address: C.agenticCommerce, abi: AgenticCommerceABI,
          functionName: 'getJob', args: [BigInt(a.key)],
        }) as { provider: Address; evaluator: Address };
        if (a.kind === 'reject') {
          if (job.evaluator.toLowerCase() !== author) {
            throw new Error('reject content: author must equal the tier-job evaluator (requester)');
          }
        } else if (job.provider.toLowerCase() !== author) {
          throw new Error('deliver content: author must equal the tier-job provider');
        }
      }

      // Upsert — the worker may rewrite the body before submitting on chain; once an Arc job is
      // Submitted the deliverable hash is locked, but the off-chain body is editable until then
      // (UI hides the editor after submit).
      const row = {
        id, marketId: a.marketId, kind: a.kind, key, author,
        body: a.body, hash, createdAt,
      };
      await db.insert(contents).values(row).onConflictDoUpdate({
        target: contents.id,
        set: { body: a.body, hash, author, createdAt },
      });
      return row;
    },
  },
};
