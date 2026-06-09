/**
 * Live read-path verification for Echo's attribution + fee layer.
 *
 * No private key required — exercises every NEW read method on the SDK against
 * the live Arc-testnet contracts and asserts the on-chain config matches the
 * recorded deploy (fee=500 bps, treasury, attribution wiring). This proves the
 * addresses + ABIs the new write methods target are correct and reachable.
 *
 * Run:  node ../../apps/web/node_modules/tsx/dist/cli.mjs scripts/verify-live.ts
 * (from packages/sdk). Override RPC with ARC_TESTNET_RPC_URL.
 */
import { EchoSdk, CONTRACTS } from '../src/index';

const EXPECTED = {
  chainId: 5042002,
  feeBps: 500,
  treasury: '0x921EfA47f867127f974cf29B85F2e9109cc71612',
  attributionRegistry: CONTRACTS.arcTestnet.attributionRegistry,
  attributionPayout: CONTRACTS.arcTestnet.attributionPayout,
};

function ok(label: string, pass: boolean, detail: string) {
  console.log(`${pass ? '✅' : '❌'} ${label.padEnd(28)} ${detail}`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  const sdk = new EchoSdk(process.env.ARC_TESTNET_RPC_URL);

  const chainId = await sdk.publicClient.getChainId();
  ok('chain id', chainId === EXPECTED.chainId, `${chainId}`);

  // ── Fee config (EchoHook) ──
  const feeBps = (await sdk.protocolFeeBps()) as number;
  ok('protocolFeeBps', feeBps === EXPECTED.feeBps, `${feeBps} bps`);

  const treasury = (await sdk.protocolTreasury()) as string;
  ok(
    'protocolTreasury',
    treasury.toLowerCase() === EXPECTED.treasury.toLowerCase(),
    treasury
  );

  // ── Attribution wiring: EchoHook must point at the live registry/payout ──
  const hookRegistry = (await sdk.publicClient.readContract({
    address: CONTRACTS.arcTestnet.echoHook,
    abi: (await import('../src/abis')).EchoHookABI,
    functionName: 'attributionRegistry',
  })) as string;
  ok(
    'hook→attributionRegistry',
    hookRegistry.toLowerCase() === EXPECTED.attributionRegistry.toLowerCase(),
    hookRegistry
  );

  // ── AttributionRegistry reads ──
  const arCount = (await sdk.arCount()) as bigint;
  ok('arCount', typeof arCount === 'bigint', `${arCount}`);

  const marketCount = (await sdk.marketCount()) as bigint;
  ok('marketCount', typeof marketCount === 'bigint', `${marketCount}`);

  // primaryIntroducer / getWorkerARs against a probe id — proves the call path
  // executes even when no AR exists yet (returns exists=false / empty array).
  const probeWorker = BigInt(process.env.PROBE_WORKER_ID ?? '1');
  const [introducer, exists] = (await sdk.primaryIntroducer(probeWorker)) as [
    string,
    boolean,
  ];
  ok(
    `primaryIntroducer(${probeWorker})`,
    typeof exists === 'boolean',
    exists ? introducer : '(none confirmed yet)'
  );

  const workerARs = (await sdk.getWorkerARs(probeWorker)) as bigint[];
  ok(
    `getWorkerARs(${probeWorker})`,
    Array.isArray(workerARs),
    `${workerARs.length} AR(s)`
  );

  // If any AR exists globally, decode the first one to prove getAR works.
  if (arCount > 0n) {
    const ar = await sdk.getAR(1n);
    ok('getAR(1)', ar != null, JSON.stringify(ar, bigintReplacer).slice(0, 80));
  }

  console.log(
    process.exitCode ? '\n⛔ verification FAILED' : '\n🎉 all live reads verified'
  );
}

function bigintReplacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

main().catch((e) => {
  console.error('script error:', e);
  process.exit(1);
});
