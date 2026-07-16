import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { cursor, events } from '../db/schema.js';
import { publicClient } from '../chain.js';
import { MarketRegistryABI, DisputeResolverABI, EchoHookABI } from '../abis.js';
import { config } from '../config.js';
import { applyEvent } from './reducers.js';

const SOURCES = [
  { address: config.contracts.marketRegistry as `0x${string}`, abi: MarketRegistryABI },
  { address: config.contracts.disputeResolver as `0x${string}`, abi: DisputeResolverABI },
  { address: config.contracts.echoHook as `0x${string}`, abi: EchoHookABI }, // settlement / reputation
];
// One merged getLogs per range instead of one per source — Arc's public RPC rate-limits by
// request count ("request limit reached"), so 3× fewer calls is the difference between keeping
// up and being throttled into a frozen cursor. Event signatures are distinct across the three
// contracts, so decoding against the merged ABI is unambiguous.
const ALL_ADDRESSES = SOURCES.map((s) => s.address);
const MERGED_ABI = SOURCES.flatMap((s) => s.abi as unknown as any[]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Operator kill-switch. The ops dashboard (apps/ops) owns `ops_feature_flags`; when `indexer.paused`
 * is true the loop idles instead of ingesting. Returns false if the table doesn't exist yet (ops
 * never ran) so indexing is never blocked by a missing dependency.
 */
async function isIngestPaused(): Promise<boolean> {
  try {
    const rows = (await db.execute(
      sql`SELECT enabled FROM ops_feature_flags WHERE key = 'indexer.paused' LIMIT 1`,
    )) as unknown as Array<{ enabled: boolean }>;
    return Boolean(rows[0]?.enabled);
  } catch {
    return false;
  }
}

async function getCursor(): Promise<bigint> {
  const [row] = await db.select().from(cursor).where(eq(cursor.id, 'head')).limit(1);
  if (row) return BigInt(row.lastBlock);
  // First run: index from startBlock (so lastBlock = startBlock - 1).
  const last = config.startBlock > 0n ? config.startBlock - 1n : 0n;
  await db.insert(cursor).values({ id: 'head', lastBlock: Number(last) }).onConflictDoNothing();
  return last;
}

async function setCursor(block: bigint): Promise<void> {
  await db.insert(cursor).values({ id: 'head', lastBlock: Number(block) })
    .onConflictDoUpdate({ target: cursor.id, set: { lastBlock: Number(block) } });
}

/** Decode every event from all three contracts over [fromBlock, toBlock], reduce, persist. */
async function indexRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const logs = (await publicClient.getContractEvents({
    address: ALL_ADDRESSES, abi: MERGED_ABI, fromBlock, toBlock,
  } as never)) as any[];
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));

  const now = Math.floor(Date.now() / 1000);
  for (const log of logs) {
    const eventName = log.eventName as string;
    const args = (log.args ?? {}) as Record<string, any>;
    let res: { marketId: number | null; actor: string | null };
    try {
      res = await applyEvent(eventName, args, { block: Number(log.blockNumber), now });
    } catch (e) {
      console.error('[reduce]', eventName, (e as Error).message);
      res = { marketId: args.marketId !== undefined ? Number(args.marketId) : null, actor: null };
    }
    await db.insert(events).values({
      blockNumber: Number(log.blockNumber), txHash: log.transactionHash, logIndex: log.logIndex,
      address: log.address, eventName, marketId: res.marketId, actor: res.actor ? res.actor.toLowerCase() : null,
      args: JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), createdAt: now,
    }).onConflictDoNothing();
  }
  if (logs.length) console.log(`[ingest] blocks ${fromBlock}-${toBlock}: ${logs.length} events`);
}

/** Smallest getLogs span we'll shrink to before treating a range failure as a real outage. */
const MIN_BATCH = 50n;

/** Does this error mean "too many requests" (a per-window request-count limit)? Arc's public RPC
 *  answers `request limit reached`; other providers say 429 / rate limit / -32005. Distinct from
 *  span-size caps: shrinking the batch doesn't help — only waiting out the window does. */
const isRateLimit = (e: unknown): boolean =>
  /request limit|rate limit|too many request|429|-32005/i.test(String((e as Error)?.message ?? e));

/** Exponential backoff for rate limiting: 5s → 10s → … → 2min cap. */
const RATE_LIMIT_BASE_MS = 5_000;
const RATE_LIMIT_CAP_MS = 120_000;

/** Pacing between successful backfill batches so a long catch-up doesn't re-trip the limit. */
const BACKFILL_PACE_MS = 300;

/** Backfill from the cursor to head, then poll head forever. */
export async function runIngestLoop(): Promise<void> {
  let from = (await getCursor()) + 1n;
  let batch = config.batchSize; // adaptive: halves on RPC failures, grows back on success
  let rateLimitStreak = 0; // consecutive rate-limit hits anywhere in the loop → exponential backoff
  console.log(`[ingest] starting from block ${from}`);
  for (;;) {
    try {
      if (await isIngestPaused()) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      // Pick up an external cursor rewind (ops "re-index from block"): if the persisted cursor is
      // now behind our position, restart ingestion from there. Normal forward progress is untouched.
      const persisted = (await getCursor()) + 1n;
      if (persisted < from) {
        console.log(`[ingest] cursor rewound externally → re-indexing from block ${persisted}`);
        from = persisted;
      }
      const head = await publicClient.getBlockNumber();
      let failures = 0; // consecutive non-rate-limit failures on the CURRENT range
      while (from <= head) {
        const to = from + batch - 1n > head ? head : from + batch - 1n;
        try {
          await indexRange(from, to);
          await setCursor(to);
          from = to + 1n;
          failures = 0;
          rateLimitStreak = 0;
          // Healthy batch → grow back toward the configured size (we may have shrunk below).
          if (batch < config.batchSize) batch = batch * 2n > config.batchSize ? config.batchSize : batch * 2n;
          if (from <= head) await sleep(BACKFILL_PACE_MS); // pace the backfill, stay under the limit
        } catch (e) {
          const msg = (e as Error).message.slice(0, 120);
          // Rate limited → the request window is exhausted; retrying fast or shrinking the span
          // only digs deeper (prod froze ~190k blocks behind doing exactly that). Back off
          // exponentially and retry the SAME range at the SAME size once the window clears.
          if (isRateLimit(e)) {
            rateLimitStreak++;
            const wait = Math.min(RATE_LIMIT_BASE_MS * 2 ** (rateLimitStreak - 1), RATE_LIMIT_CAP_MS);
            console.warn(`[ingest] rate-limited on ${from}-${to} — backing off ${wait / 1000}s (streak ${rateLimitStreak})`);
            await sleep(wait);
            continue;
          }
          // Arc's public RPC also fails intermittently (transient errors) — the same call can pass
          // on the next attempt. Brief pause + retry the SAME range a few times (transient), then
          // shrink the batch (size-related caps), and only surface the error when even the minimum
          // span keeps failing. Cursor progress is preserved per-range throughout.
          failures++;
          if (failures <= 3) {
            console.warn(`[ingest] range ${from}-${to} failed (attempt ${failures}: ${msg}) — retrying same range`);
            await sleep(1000 * failures);
            continue;
          }
          if (batch > MIN_BATCH) {
            batch = batch / 2n < MIN_BATCH ? MIN_BATCH : batch / 2n;
            failures = 0;
            console.warn(`[ingest] range ${from}-${to} keeps failing — shrinking to batch=${batch}`);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      // Rate limits can also hit outside indexRange (e.g. getBlockNumber). A flat short sleep here
      // is how the loop used to hammer a throttled endpoint every 4s forever — back off instead.
      if (isRateLimit(e)) {
        rateLimitStreak++;
        const wait = Math.min(RATE_LIMIT_BASE_MS * 2 ** (rateLimitStreak - 1), RATE_LIMIT_CAP_MS);
        console.warn(`[ingest] rate-limited at head poll — backing off ${wait / 1000}s (streak ${rateLimitStreak})`);
        await sleep(wait);
        continue;
      }
      console.error('[ingest] error:', (e as Error).message);
    }
    await sleep(config.pollIntervalMs);
  }
}
