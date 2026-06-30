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

/** Decode every event from both contracts over [fromBlock, toBlock], reduce, persist. */
async function indexRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const logs: any[] = [];
  for (const src of SOURCES) {
    const part = await publicClient.getContractEvents({ address: src.address, abi: src.abi, fromBlock, toBlock } as never);
    logs.push(...(part as any[]));
  }
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

/** Backfill from the cursor to head, then poll head forever. */
export async function runIngestLoop(): Promise<void> {
  let from = (await getCursor()) + 1n;
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
      while (from <= head) {
        const to = from + config.batchSize - 1n > head ? head : from + config.batchSize - 1n;
        await indexRange(from, to);
        await setCursor(to);
        from = to + 1n;
      }
    } catch (e) {
      console.error('[ingest] error:', (e as Error).message);
    }
    await sleep(config.pollIntervalMs);
  }
}
