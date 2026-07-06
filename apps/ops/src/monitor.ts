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

async function pingIndexer(): Promise<boolean> {
  try {
    const res = await fetch(config.indexerGraphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** One snapshot for the status panel: chain head, indexer lag, deployer balance, dispute config, owner checks. */
export async function snapshot() {
  const c = config.contracts;
  const deployer = ownerAccount?.address ?? null;

  const [head, cursor, disputes, events, indexerUp] = await Promise.all([
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
      up: indexerUp,
      cursor,
      lag: head != null && cursor != null ? Number(head) - cursor : null,
      events,
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
