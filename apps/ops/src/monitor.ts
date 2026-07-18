import { formatUnits } from 'viem';
import { config, writesEnabled } from './config.js';
import { publicClient, ownerAccount, DISPUTE_RESOLVER_ABI, OWNABLE_ABI } from './chain.js';
import { indexerCursor, disputeCounts, eventCount } from './db.js';

async function ownerOf(address: `0x${string}`): Promise<string | null> {
  try {
    return (await publicClient.readContract({ address, abi: OWNABLE_ABI, functionName: 'owner' })) as string;
  } catch {
    return null;
  }
}

type IngestHealth = { ingestBlock: number; ingestState: string; ingestUpdatedAt: number; prevCursor: number | null };

/** One GraphQL round-trip doubles as the liveness ping AND fetches the ingest loop's live state
 *  (in-memory position + what it's doing) — the DB cursor alone can't tell a stall from a backfill. */
async function pingIndexer(): Promise<IngestHealth | null> {
  try {
    const res = await fetch(config.indexerGraphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ health { ingestBlock ingestState ingestUpdatedAt prevCursor } }' }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { data?: { health?: IngestHealth } } | null;
    // An older indexer image without the ingest fields still counts as "up".
    return body?.data?.health ?? { ingestBlock: 0, ingestState: 'unknown (indexer image predates ingest status)', ingestUpdatedAt: 0, prevCursor: null };
  } catch {
    return null;
  }
}

/** One snapshot for the status panel: chain head, indexer lag, deployer balance, dispute config, owner checks. */
export async function snapshot() {
  const c = config.contracts;
  const deployer = ownerAccount?.address ?? null;

  const [head, cursor, disputes, events, ingest] = await Promise.all([
    publicClient.getBlockNumber().catch(() => null),
    indexerCursor(),
    disputeCounts(),
    eventCount(),
    pingIndexer(),
  ]);

  // DisputeResolver config + ownership; deployer native (USDC) balance; owner of each proxy.
  const [drConfig, balanceWei, drOwner, mrOwner, hookOwner, vgOwner] = await Promise.all([
    Promise.all([
      publicClient.readContract({ address: c.disputeResolver, abi: DISPUTE_RESOLVER_ABI, functionName: 'modeAStakeEnabled' }),
      publicClient.readContract({ address: c.disputeResolver, abi: DISPUTE_RESOLVER_ABI, functionName: 'minBond' }),
      publicClient.readContract({ address: c.disputeResolver, abi: DISPUTE_RESOLVER_ABI, functionName: 'votingPeriod' }),
      publicClient.readContract({ address: c.disputeResolver, abi: DISPUTE_RESOLVER_ABI, functionName: 'jurorCount' }),
      publicClient.readContract({ address: c.disputeResolver, abi: DISPUTE_RESOLVER_ABI, functionName: 'disputeCount' }),
    ]).catch(() => null),
    deployer ? publicClient.getBalance({ address: deployer }).catch(() => null) : Promise.resolve(null),
    ownerOf(c.disputeResolver),
    ownerOf(c.marketRegistry),
    ownerOf(c.echoHook),
    ownerOf(c.validationGate),
  ]);

  const sameOwner = (o: string | null) =>
    o != null && deployer != null && o.toLowerCase() === deployer.toLowerCase();

  return {
    chain: {
      head: head != null ? Number(head) : null,
      rpcUrl: config.rpcUrl,
    },
    indexer: {
      up: ingest != null,
      cursor,
      lag: head != null && cursor != null ? Number(head) - cursor : null,
      events,
      // Live loop state (vs `cursor`, which only moves on commit): where ingestion actually is,
      // what it's doing, when it last reported, and the cursor as it was before the last re-index.
      ingestBlock: ingest?.ingestBlock ?? null,
      ingestState: ingest?.ingestState ?? null,
      ingestUpdatedAt: ingest?.ingestUpdatedAt ?? null,
      prevCursor: ingest?.prevCursor ?? null,
    },
    disputes,
    disputeResolver: drConfig
      ? {
          modeAStakeEnabled: Boolean(drConfig[0]),
          minBond: (drConfig[1] as bigint).toString(),
          votingPeriodSecs: Number(drConfig[2]),
          jurorCount: Number(drConfig[3]),
          disputeCount: Number(drConfig[4]),
        }
      : null,
    deployer: {
      address: deployer,
      writesEnabled,
      usdcBalance: balanceWei != null ? formatUnits(balanceWei, 6) : null,
    },
    ownership: {
      // true = the configured deployer key actually owns the proxy (so writes will succeed).
      disputeResolver: { owner: drOwner, isDeployer: sameOwner(drOwner) },
      marketRegistry: { owner: mrOwner, isDeployer: sameOwner(mrOwner) },
      echoHook: { owner: hookOwner, isDeployer: sameOwner(hookOwner) },
      validationGate: { owner: vgOwner, isDeployer: sameOwner(vgOwner) },
    },
    contracts: c,
  };
}
