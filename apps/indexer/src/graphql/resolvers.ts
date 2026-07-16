import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { keccak256, toBytes, type Address } from 'viem';
import { AgenticCommerceABI, CONTRACTS } from '@echo/sdk';
import { db } from '../db/client.js';
import { markets, applications, findings, milestones, disputes, events, cursor, reputation, contents, attachments, agentWallets } from '../db/schema.js';
import { publicClient } from '../chain.js';
import { config } from '../config.js';

const C = CONTRACTS.arcTestnet;

// Demo simplification: we trust the client-claimed viewer/author address. Role gating against
// on-chain state still runs (apply → key match, deliver → provider match, reveal-gate for reads)
// but a malicious client could spoof their address and read other people's bodies. Acceptable for
// testnet; replace with E2E encryption before mainnet. See memory: echo-content-channel-gap.

// Per-event lifecycle tag for the pending/completed split in the activity feed.
const PENDING = new Set([
  'Applied', 'FindingSubmitted', 'MilestoneSubmitted', 'DisputeOpened', 'DisputeCountered', 'Voted', 'RevealFlagged',
]);

// An event is only PENDING while its market is still open. Every market is terminal eventually
// (closed / cancelled — deadlines guarantee nothing stays open forever), and once it settles nothing
// on it can still need action. So a would-be-PENDING event on a non-active market reads COMPLETED.
// `activeMarketIds` is the set of market ids whose status is still 'active'; pass null when unknown
// (e.g. the market row is missing) to fall back to the name-only rule.
const stateOf = (name: string, marketId: number | null, activeMarketIds: Set<number> | null) => {
  if (!PENDING.has(name)) return 'COMPLETED';
  if (activeMarketIds && marketId !== null && !activeMarketIds.has(marketId)) return 'COMPLETED';
  return 'PENDING';
};

const marketOut = (m: any) => ({ ...m, tiers: m.tiers ? JSON.parse(m.tiers) : null });

// ── Shared content-channel gates (used by both text `contents` and file `attachments`) ──
// Keeping these in one place means an attachment is gated identically to the body it rides with —
// they can never drift apart. Both throw on violation; callers proceed only if they return.

/** READ gate: may `viewer` read {kind,key} content for this market? Enforces SIWE match + role rules
 *  (apply → participant always, requester only after reveal; deliver/reject → job provider|evaluator). */
async function assertCanReadContent(
  marketId: number, kind: string, key: string, viewer: string, proven: string | null,
): Promise<void> {
  // Preview is PUBLIC by design (the applicant's opt-in teaser) — the AI agent screens it for free
  // and anyone browsing can read it. No viewer/SIWE/role checks. See the preview-screen design (#4).
  if (kind === 'preview') return;

  if (!viewer) throw new Error('viewer required');
  if (config.requireAuth && !proven) throw new Error('sign-in required (SIWE session missing)');
  if (proven && proven !== viewer.toLowerCase()) throw new Error('viewer must match the signed-in address');

  const v = viewer.toLowerCase();
  const k = key.toLowerCase();
  if (kind === 'apply') {
    const [m] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
    if (!m) throw new Error('Market not found');
    const isParticipant = v === k;
    const isRequester = v === m.requester.toLowerCase();
    if (!isParticipant && !isRequester) throw new Error('Forbidden');
    if (isRequester) {
      const [app] = await db.select().from(applications)
        .where(and(eq(applications.marketId, marketId), eq(sql`lower(${applications.participant})`, k)))
        .limit(1);
      if (!app || app.tierReached < 1) throw new Error('Reveal required');
    }
  } else if (kind === 'deliver' || kind === 'reject') {
    const job = await publicClient.readContract({
      address: C.agenticCommerce, abi: AgenticCommerceABI,
      functionName: 'getJob', args: [BigInt(key)],
    }) as { provider: Address; evaluator: Address };
    if (![job.provider.toLowerCase(), job.evaluator.toLowerCase()].includes(v)) throw new Error('Forbidden');
  } else {
    throw new Error('Unknown content kind');
  }
}

/** WRITE gate: may `author` write {kind,key} for this market? apply → author == participant;
 *  deliver → author == job provider; reject → author == job evaluator. */
async function assertCanWriteContent(
  kind: string, key: string, author: string,
): Promise<void> {
  const k = key.toLowerCase();
  if (kind === 'apply' || kind === 'preview') {
    // Preview is written by the applicant, keyed by their own address — same rule as apply.
    if (author !== k) throw new Error(`${kind} content: author must equal the participant address`);
  } else if (kind === 'deliver' || kind === 'reject') {
    const job = await publicClient.readContract({
      address: C.agenticCommerce, abi: AgenticCommerceABI,
      functionName: 'getJob', args: [BigInt(key)],
    }) as { provider: Address; evaluator: Address };
    if (kind === 'reject') {
      if (job.evaluator.toLowerCase() !== author) throw new Error('reject content: author must equal the tier-job evaluator (requester)');
    } else if (job.provider.toLowerCase() !== author) {
      throw new Error('deliver content: author must equal the tier-job provider');
    }
  } else {
    throw new Error('Unknown content kind');
  }
}

// Attachment guardrails: docs-only, base64 in Postgres. Cap the raw size so the DB can't bloat.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB raw

/**
 * A user's on-chain identity is their wallet PLUS their agent wallet (the Circle DCW that creates
 * agent-run markets as its own `requester`). Every "my stuff" query must match the whole family, or
 * agent markets silently vanish from My markets / activity / profiles.
 */
async function addressFamily(addr: string): Promise<string[]> {
  const owner = addr.toLowerCase();
  const family = [owner];
  const [w] = await db.select().from(agentWallets).where(eq(agentWallets.owner, owner)).limit(1);
  if (w) family.push(w.walletAddress.toLowerCase());
  return family;
}

export const resolvers = {
  Query: {
    markets: async (_: unknown, a: { mode?: number; status?: string; requester?: string; openOnly?: boolean; limit?: number }) => {
      const conds = [];
      if (a.mode !== undefined && a.mode !== null) conds.push(eq(markets.mode, a.mode));
      if (a.status) conds.push(eq(markets.status, a.status));
      if (a.openOnly) conds.push(eq(markets.status, 'active'));
      // Address columns aren't normalised on insert (events stay as viem returns them, which is
      // EIP-55 checksum), so compare case-insensitively here — otherwise My Markets misses every
      // row when the wallet returns a different case than the indexer stored. Matches the caller's
      // whole address family so agent-run markets (requester = their DCW) appear too.
      if (a.requester) {
        const family = await addressFamily(a.requester);
        conds.push(inArray(sql`LOWER(${markets.requester})`, family));
      }
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
      // events where the wallet is the actor OR owns the market (requester-side), across the whole
      // address family (wallet + agent DCW) so agent-market activity shows under its human owner.
      // Case-insensitive requester match — markets.requester is stored as viem returned it (checksum).
      const family = await addressFamily(addr);
      const mine = await db.select({ id: markets.id }).from(markets)
        .where(inArray(sql`LOWER(${markets.requester})`, family));
      const ids = mine.map((r) => r.id);
      const actorMatch = family.length > 1 ? inArray(events.actor, family) : eq(events.actor, addr);
      const ownership = ids.length ? or(actorMatch, inArray(events.marketId, ids)) : actorMatch;
      const rows = await db.select().from(events).where(ownership)
        .orderBy(desc(events.blockNumber), desc(events.logIndex)).limit(a.limit ?? 100);
      // Which of the referenced markets are still open? Anything closed/cancelled resolves its
      // otherwise-pending events to COMPLETED so nothing lingers as "Pending" past settlement.
      const active = await db.select({ id: markets.id }).from(markets).where(eq(markets.status, 'active'));
      const activeIds = new Set(active.map((r) => r.id));
      return rows
        .map((e) => ({ ...e, state: stateOf(e.eventName, e.marketId, activeIds) }))
        .filter((e) => !a.status || e.state === a.status);
    },

    marketActivity: async (_: unknown, a: { marketId: number; limit?: number }) => {
      // Oldest-first for the timeline UI; the page reads it as a linear progression.
      const rows = await db.select().from(events).where(eq(events.marketId, a.marketId))
        .orderBy(events.blockNumber, events.logIndex).limit(a.limit ?? 200);
      const [m] = await db.select({ status: markets.status }).from(markets).where(eq(markets.id, a.marketId)).limit(1);
      const activeIds = m ? (m.status === 'active' ? new Set([a.marketId]) : new Set<number>()) : null;
      return rows.map((e) => ({ ...e, state: stateOf(e.eventName, e.marketId, activeIds) }));
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
      ctx: { address: string | null },
    ) => {
      await assertCanReadContent(a.marketId, a.kind, a.key, a.viewer, ctx.address?.toLowerCase() ?? null);
      const id = `${a.marketId}-${a.kind}-${a.key.toLowerCase()}`;
      const [row] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
      return row ?? null;
    },

    // File attachments for {kind,key}, gated identically to `content` (same viewer rules). METADATA
    // ONLY — the heavy base64 `data` is null here so listing a slot with several big files stays
    // cheap; fetch one file's bytes on demand via `attachmentData`. Empty list when none.
    attachments: async (
      _: unknown,
      a: { marketId: number; kind: string; key: string; viewer: string },
      ctx: { address: string | null },
    ) => {
      await assertCanReadContent(a.marketId, a.kind, a.key, a.viewer, ctx.address?.toLowerCase() ?? null);
      const rows = await db.select({
        id: attachments.id, marketId: attachments.marketId, kind: attachments.kind, key: attachments.key,
        author: attachments.author, filename: attachments.filename, mime: attachments.mime,
        size: attachments.size, hash: attachments.hash, createdAt: attachments.createdAt,
      }).from(attachments)
        .where(and(
          eq(attachments.marketId, a.marketId),
          eq(attachments.kind, a.kind),
          eq(attachments.key, a.key.toLowerCase()),
        ))
        .orderBy(attachments.createdAt);
      // `data` is intentionally absent (fetched per-file below); null keeps the GraphQL field happy.
      return rows.map((r) => ({ ...r, data: null }));
    },

    // Fetch ONE attachment's bytes (base64 `data`) by id — used on download click and by the agent.
    // Re-runs the same read gate against the row's own {marketId,kind,key} slot so a leaked id can't
    // bypass the reveal/role rules.
    attachmentData: async (
      _: unknown,
      a: { id: string; viewer: string },
      ctx: { address: string | null },
    ) => {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, a.id)).limit(1);
      if (!row) return null;
      await assertCanReadContent(row.marketId, row.kind, row.key, a.viewer, ctx.address?.toLowerCase() ?? null);
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
      ctx: { address: string | null },
    ) => {
      if (!a.author) throw new Error('author required');
      if (!['apply', 'deliver', 'reject', 'preview'].includes(a.kind)) throw new Error('Unknown content kind');

      // SIWE authz: the write is attributed to `author`, so the caller must have *proven* control of
      // that address. When requireAuth is on, a session is mandatory. When off (legacy rollout), an
      // authenticated caller is still held to author==provenAddress, but an unauthenticated caller
      // falls back to the old on-chain role gate below. See config.requireAuth.
      const proven = ctx.address?.toLowerCase() ?? null;
      if (config.requireAuth && !proven) throw new Error('sign-in required (SIWE session missing)');
      if (proven && proven !== a.author.toLowerCase()) {
        throw new Error('author must match the signed-in address');
      }

      const author = a.author.toLowerCase();
      const key = a.key.toLowerCase();
      const id = `${a.marketId}-${a.kind}-${key}`;
      const hash = keccak256(toBytes(a.body));
      const createdAt = Math.floor(Date.now() / 1000);

      // Authorship gate against on-chain state (shared with storeAttachment).
      await assertCanWriteContent(a.kind, a.key, author);

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

    // Upload one file attachment for {kind,key}. Author-gated identically to storeContent. `data` is
    // base64 of the file bytes; we cap the raw size (docs-only) so the DB can't bloat. Each call adds
    // a new row (append, not upsert) so a submission can carry several files.
    storeAttachment: async (
      _: unknown,
      a: { marketId: number; kind: string; key: string; filename: string; mime: string; data: string; author: string },
      ctx: { address: string | null },
    ) => {
      if (!a.author) throw new Error('author required');
      if (!['apply', 'deliver', 'reject'].includes(a.kind)) throw new Error('Unknown content kind');
      if (!a.data) throw new Error('empty file');

      const proven = ctx.address?.toLowerCase() ?? null;
      if (config.requireAuth && !proven) throw new Error('sign-in required (SIWE session missing)');
      if (proven && proven !== a.author.toLowerCase()) throw new Error('author must match the signed-in address');

      const author = a.author.toLowerCase();
      const key = a.key.toLowerCase();
      await assertCanWriteContent(a.kind, a.key, author);

      const bytes = Buffer.from(a.data, 'base64');
      if (bytes.length === 0) throw new Error('empty or invalid base64 file');
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`file too large: ${bytes.length} bytes (max ${MAX_ATTACHMENT_BYTES})`);
      }

      const createdAt = Math.floor(Date.now() / 1000);
      // Unique id per upload — count existing rows for this slot so re-uploads don't collide.
      const existing = await db.select({ c: sql<number>`count(*)` }).from(attachments)
        .where(and(eq(attachments.marketId, a.marketId), eq(attachments.kind, a.kind), eq(attachments.key, key)));
      const n = Number(existing[0]?.c ?? 0);
      const row = {
        id: `${a.marketId}-${a.kind}-${key}-${createdAt}-${n}`,
        marketId: a.marketId, kind: a.kind, key, author,
        filename: a.filename || 'file', mime: a.mime || 'application/octet-stream',
        size: bytes.length, data: a.data, hash: keccak256(bytes), createdAt,
      };
      await db.insert(attachments).values(row);
      return row;
    },

    // Remove an attachment. Only the original uploader (author) may delete, and only while they still
    // pass the write gate (e.g. before an Arc job locks). Returns true on delete.
    deleteAttachment: async (
      _: unknown,
      a: { id: string; author: string },
      ctx: { address: string | null },
    ) => {
      const proven = ctx.address?.toLowerCase() ?? null;
      if (config.requireAuth && !proven) throw new Error('sign-in required (SIWE session missing)');
      if (proven && proven !== a.author.toLowerCase()) throw new Error('author must match the signed-in address');

      const author = a.author.toLowerCase();
      const [row] = await db.select().from(attachments).where(eq(attachments.id, a.id)).limit(1);
      if (!row) return false;
      if (row.author.toLowerCase() !== author) throw new Error('only the uploader can delete this file');
      await assertCanWriteContent(row.kind, row.key, author);
      await db.delete(attachments).where(eq(attachments.id, a.id));
      return true;
    },
  },
};
