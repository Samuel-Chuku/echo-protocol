import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { keccak256, recoverMessageAddress, toBytes, type Address } from 'viem';
import { AgenticCommerceABI, CONTRACTS } from '@echo/sdk';
import { db } from '../db/client.js';
import { markets, applications, findings, milestones, disputes, events, cursor, reputation, contents } from '../db/schema.js';
import { publicClient } from '../chain.js';

const C = CONTRACTS.arcTestnet;

type ContentAuth = { address: string; message: string; signature: `0x${string}` };

/**
 * Verify a wallet signature and return the lowercased address. Tries EOA recovery first (cheap,
 * works for any EOA + handles wallets that mis-route 1271), then falls back to verifyMessage
 * (which itself dispatches EOA + EIP-1271 / Circle modular wallets). Enforces a 24h freshness
 * window on the embedded `ts=<unix>` field. Throws with a diagnostic on every failure path so
 * we can tell EOA-mismatch from contract-call-failed from address-mismatch.
 */
async function authenticate(auth: ContentAuth): Promise<string> {
  if (!auth?.address || !auth.message || !auth.signature) throw new Error('Auth required');
  const tsMatch = auth.message.match(/ts=(\d+)/);
  if (!tsMatch) throw new Error('Auth message missing ts');
  const ts = Number(tsMatch[1]);
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > 86_400) throw new Error('Auth signature expired (>24h)');

  const claimed = auth.address.toLowerCase();

  // Path 1: EOA recovery. Cheap, no RPC. If the recovered address matches the claim, we're done.
  // If it doesn't, the wallet might be a smart account — fall through to EIP-1271.
  let recovered: string | null = null;
  try {
    recovered = (await recoverMessageAddress({ message: auth.message, signature: auth.signature })).toLowerCase();
    if (recovered === claimed) return claimed;
  } catch (e: unknown) {
    // recoverMessageAddress throws on malformed signatures (e.g. webauthn blob from passkey).
    // Not fatal — verifyMessage will handle that via EIP-1271.
  }

  // Path 2: EIP-1271 (smart account). Calls the SCA's isValidSignature on chain. Needs the SCA
  // to be deployed at the claimed address; counterfactual SCAs will fail here without factoryData.
  try {
    const ok = await publicClient.verifyMessage({
      address: auth.address as Address,
      message: auth.message,
      signature: auth.signature,
    });
    if (ok) return claimed;
  } catch (e: unknown) {
    // verifyMessage throws when the EIP-1271 contract call reverts — surface a clear hint.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Auth EIP-1271 call failed for ${auth.address}: ${msg.slice(0, 160)}. ` +
      `If you're on a Circle passkey wallet, make sure the smart account is deployed (any prior tx will deploy it).`,
    );
  }

  // Reached when EOA recovered to a different address AND EIP-1271 returned the non-magic value.
  throw new Error(
    `Auth signature invalid — recovered ${recovered ?? '(no EOA recovery)'} but claim is ${claimed}. ` +
    `Likely cause: the wallet that signed is not the wallet you say it is.`,
  );
}

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
      a: { marketId: number; kind: string; key: string; auth: ContentAuth },
    ) => {
      const caller = await authenticate(a.auth);
      const key = a.key.toLowerCase();
      const id = `${a.marketId}-${a.kind}-${key}`;
      const [row] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
      if (!row) return null;

      // Gating: apply content is the participant's own writeup, visible to them always; visible
      // to the requester once the on-chain reveal has happened (applications.tierReached >= 1).
      // Deliver content is keyed by Arc jobId — both the job's provider and evaluator may read.
      if (a.kind === 'apply') {
        const [m] = await db.select().from(markets).where(eq(markets.id, a.marketId)).limit(1);
        if (!m) throw new Error('Market not found');
        const isParticipant = caller === key;
        const isRequester = caller === m.requester.toLowerCase();
        if (!isParticipant && !isRequester) throw new Error('Forbidden');
        if (isRequester) {
          // Reveal-gate: requester sees apply text only after they've revealed THIS participant.
          const [app] = await db.select().from(applications)
            .where(eq(applications.id, `${a.marketId}-${key}`)).limit(1);
          if (!app || app.tierReached < 1) throw new Error('Reveal required');
        }
      } else if (a.kind === 'deliver') {
        // Read the Arc job from chain — UI guarantees jobId is valid; check provider/evaluator.
        const job = await publicClient.readContract({
          address: C.agenticCommerce, abi: AgenticCommerceABI,
          functionName: 'getJob', args: [BigInt(a.key)],
        }) as { provider: Address; evaluator: Address };
        const allowed = [job.provider.toLowerCase(), job.evaluator.toLowerCase()];
        if (!allowed.includes(caller)) throw new Error('Forbidden');
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
      a: { marketId: number; kind: string; key: string; body: string; auth: ContentAuth },
    ) => {
      const caller = await authenticate(a.auth);
      if (!['apply', 'deliver'].includes(a.kind)) throw new Error('Unknown content kind');

      const key = a.key.toLowerCase();
      const id = `${a.marketId}-${a.kind}-${key}`;
      const hash = keccak256(toBytes(a.body));
      const createdAt = Math.floor(Date.now() / 1000);

      // Authorship gate — the worker writes their own apply text; for deliverables we trust the
      // worker (provider) to be the author, verified against the Arc job. Anyone else gets a 403.
      if (a.kind === 'apply') {
        if (caller !== key) throw new Error('Only the applicant may store their apply content');
      } else {
        const job = await publicClient.readContract({
          address: C.agenticCommerce, abi: AgenticCommerceABI,
          functionName: 'getJob', args: [BigInt(a.key)],
        }) as { provider: Address };
        if (job.provider.toLowerCase() !== caller) {
          throw new Error('Only the tier job provider may store deliverable content');
        }
      }

      // Upsert (the worker may rewrite their text before grading; once an Arc job is Submitted on
      // chain the deliverable hash is locked, but the off-chain body is editable until then —
      // UI hides the editor after submit).
      const row = {
        id, marketId: a.marketId, kind: a.kind, key, author: caller,
        body: a.body, hash, createdAt,
      };
      await db.insert(contents).values(row).onConflictDoUpdate({
        target: contents.id,
        set: { body: a.body, hash, author: caller, createdAt },
      });
      return row;
    },
  },
};
