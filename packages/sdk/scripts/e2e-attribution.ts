/**
 * End-to-end LIVE proof of Echo's attribution flow on Arc testnet.
 *
 *   propose AR (introducer) → create market + apply (requester/worker)
 *   → grade (fires recordGrade) → confirm AR (independent requester)
 *   → complete the tier job → assert the introducer was paid their slice.
 *
 * Requires three funded testnet accounts (USDC for gas + escrow). Set as raw
 * 0x-prefixed private keys in the environment (never commit them):
 *
 *   INTRODUCER_PRIVATE_KEY   the AR originator who should get paid
 *                            (falls back to PRIVATE_KEY)
 *   REQUESTER_PRIVATE_KEY    creates the market, grades, co-signs the AR
 *                            (MUST differ from the introducer — anti-sybil)
 *   WORKER_PRIVATE_KEY       applies to the market; gets an ERC-8004 identity
 *                            auto-registered if it has none
 *
 * Run from packages/sdk:
 *   node ../../node_modules/.pnpm/tsx@<v>/node_modules/tsx/dist/cli.mjs scripts/e2e-attribution.ts
 *
 * Optional env: ARC_TESTNET_RPC_URL, SLICE_BPS (default 1000 = 10%),
 *   TIER1_USDC (default 1_000000 = $1), ESCROW_USDC (default 10_000000 = $10).
 */
import {
  createWalletClient,
  http,
  parseEventLogs,
  formatUnits,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EchoSdk, CONTRACTS, AttributionType, CurveType } from '../src/index';
import { arcTestnet } from '../src/chain';
import { MarketRegistryABI } from '../src/abis';

// ── Load disposable keys from .env.e2e.local (gitignored) without a dep ──
// Existing process.env values win, so `set -x FOO …` still overrides the file.
// Works whether you run from packages/sdk or the repo root.
function loadEnvFile() {
  const candidates = process.env.E2E_ENV_FILE
    ? [process.env.E2E_ENV_FILE]
    : [
        resolve(process.cwd(), '.env.e2e.local'),
        resolve(process.cwd(), 'packages/sdk/.env.e2e.local'),
      ];
  let raw: string | undefined;
  for (const p of candidates) {
    try {
      raw = readFileSync(p, 'utf8');
      break;
    } catch {
      /* try next */
    }
  }
  if (!raw) return; // no file — rely on the ambient environment
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile();

const RPC = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
const C = CONTRACTS.arcTestnet;
// AgenticCommerce override (Path C self-hosted instance). Read AFTER loadEnvFile so it works
// from .env.e2e.local too — constants.ts captured its value at import time, before the file loaded.
const AGENTIC = (process.env.ARC_AGENTIC_COMMERCE || C.agenticCommerce) as Address;
const SLICE_BPS = Number(process.env.SLICE_BPS ?? 1000); // 10% of each payout
const TIER1 = BigInt(process.env.TIER1_USDC ?? 1_000_000); // $1
const ESCROW = BigInt(process.env.ESCROW_USDC ?? 10_000_000); // $10
const THREE_YEARS = 3 * 365 * 24 * 60 * 60;

// ── Minimal ABI for the Arc AgenticCommerce lifecycle (real 3-arg shape) ──
// Identity register/read is handled by the SDK (EchoSdk.registerIdentity etc).
const AGENTIC_ABI = [
  { type: 'function', name: 'submit', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'complete', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'reason', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
] as const;

function reqKey(name: string, fallback?: string): Hex {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing env ${name} (a 0x-prefixed private key)`);
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex;
}

type Actor = { name: string; address: Address; sdk: EchoSdk; wallet: WalletClient };

function actor(name: string, pk: Hex): Actor {
  const account = privateKeyToAccount(pk);
  const sdk = new EchoSdk(RPC);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });
  sdk.walletClient = wallet;
  return { name, address: account.address, sdk, wallet };
}

async function wait(sdk: EchoSdk, hash: Hex, label: string) {
  const r = await sdk.publicClient.waitForTransactionReceipt({ hash });
  console.log(`   ${label}: ${hash} (${r.status})`);
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  return r;
}

const usdc = (v: bigint) => `$${formatUnits(v, 6)}`;

async function main() {
  const introducer = actor('introducer', reqKey('INTRODUCER_PRIVATE_KEY', process.env.PRIVATE_KEY));
  const requester = actor('requester', reqKey('REQUESTER_PRIVATE_KEY'));
  const worker = actor('worker', reqKey('WORKER_PRIVATE_KEY'));

  if (introducer.address.toLowerCase() === requester.address.toLowerCase()) {
    throw new Error('Introducer and requester must be different accounts (anti-sybil rule)');
  }

  console.log('Actors:');
  console.log(`  introducer ${introducer.address}`);
  console.log(`  requester  ${requester.address}`);
  console.log(`  worker     ${worker.address}\n`);

  const read = introducer.sdk; // any instance works for reads

  // ── 0. Ensure worker + requester each hold an ERC-8004 identity ──
  // Arc has no address→agentId lookup, so we register (if needed) and thread the
  // returned agentId explicitly through apply/createMarket.
  async function ensureIdentity(a: Actor, uri: string): Promise<bigint> {
    const bal = (await read.identityBalanceOf(a.address)) as bigint;
    if (bal === 0n) {
      console.log(`0. ${a.name} has no identity — registering…`);
      const agentId = await a.sdk.registerIdentity(a.address, uri);
      console.log(`   ${a.name}AgentId = ${agentId} (minted)`);
      return agentId;
    }
    // Already registered but no reverse lookup: recover the id from the mint event.
    const id = await recoverAgentId(a);
    console.log(`   ${a.name}AgentId = ${id} (existing)`);
    return id;
  }

  // Recover an owned agentId by scanning the registry's Transfer(mint) events.
  async function recoverAgentId(a: Actor): Promise<bigint> {
    const logs = await read.publicClient.getLogs({
      address: C.identityRegistry,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'to', type: 'address', indexed: true },
          { name: 'tokenId', type: 'uint256', indexed: true },
        ],
      },
      args: { from: '0x0000000000000000000000000000000000000000', to: a.address },
      fromBlock: 0n,
      toBlock: 'latest',
    });
    const last = logs[logs.length - 1] as any;
    if (!last) throw new Error(`${a.name} balance>0 but no mint event found`);
    return last.args.tokenId as bigint;
  }

  const workerAgentId = await ensureIdentity(worker, 'ipfs://echo-e2e-worker');
  const requesterAgentId = await ensureIdentity(requester, 'ipfs://echo-e2e-requester');
  console.log();

  // ── 1. Introducer proposes an AR against the worker ──
  console.log('1. proposeAR (introducer)…');
  const arCountBefore = (await read.arCount()) as bigint;
  await wait(introducer.sdk, await introducer.sdk.proposeAR({
    workerAgentId,
    attributionType: AttributionType.Introduced,
    sliceBps: SLICE_BPS,
    curve: CurveType.Linear,
    durationSecs: THREE_YEARS,
    volumeCap: 0n,
  }, introducer.address), 'proposeAR');
  const arId = (await read.arCount()) as bigint;
  if (arId !== arCountBefore + 1n) throw new Error('arCount did not advance');
  console.log(`   arId = ${arId} (slice ${SLICE_BPS} bps)\n`);

  // ── 2. Requester creates a market (approve USDC → createMarket) ──
  console.log('2. createMarket (requester)…');
  await wait(requester.sdk, await requester.sdk.approveUSDC(C.marketRegistry, ESCROW, requester.address), 'approve');
  const tierAmounts: [bigint, bigint, bigint, bigint] = [TIER1, TIER1 * 2n, TIER1 * 3n, TIER1 * 4n];
  await wait(requester.sdk, await requester.sdk.createMarket({
    metadataURI: 'ipfs://echo-e2e-market',
    scopeHash: ('0x' + '11'.repeat(32)) as Hex,
    tierAmounts,
    minPRep: 0n,
    maxApplicants: 1n,
    ghostDeadline: 7n * 24n * 60n * 60n,
    escrowTotal: ESCROW,
    requesterAgentId,
  }, requester.address), 'createMarket');
  const marketId = (await read.marketCount()) as bigint; // ids are ++marketCount (1-indexed)
  console.log(`   marketId = ${marketId}\n`);

  // ── 3. Worker applies (threads its agentId) ──
  console.log('3. applyToMarket (worker)…');
  await wait(worker.sdk, await worker.sdk.applyToMarket(marketId, workerAgentId, ('0x' + '22'.repeat(32)) as Hex, worker.address), 'apply');
  console.log();

  // ── 4. Requester grades (Substantive) → fires recordGrade + creates tier job ──
  console.log('4. gradeSubstantive (requester)…');
  const gradeRcpt = await wait(requester.sdk, await requester.sdk.gradeSubstantive(marketId, worker.address, requester.address), 'grade');
  const advanced = parseEventLogs({ abi: MarketRegistryABI as any, logs: gradeRcpt.logs, eventName: 'TierAdvanced' });
  const jobId = (advanced[0] as any)?.args?.jobId as bigint;
  if (jobId == null) throw new Error('Could not read jobId from TierAdvanced event');
  console.log(`   tier job = ${jobId}`);
  const graded = await read.hasGraded(workerAgentId, requester.address);
  console.log(`   gradedBy[worker][requester] = ${graded}\n`);

  // ── 5. Independent requester co-signs the AR ──
  console.log('5. confirmAR (requester co-signs)…');
  await wait(requester.sdk, await requester.sdk.confirmAR(arId, requester.address, requester.address), 'confirmAR');
  const [intro, exists] = (await read.primaryIntroducer(workerAgentId)) as [Address, boolean];
  console.log(`   primaryIntroducer = ${intro} (exists=${exists})`);
  if (!exists || intro.toLowerCase() !== introducer.address.toLowerCase()) {
    throw new Error('AR did not confirm to the introducer');
  }
  console.log();

  // ── 6. Complete the tier job → triggers payout + fee skim + AR settlement ──
  console.log('6. complete tier job (worker submits, requester completes)…');
  const introBefore = (await read.usdcBalanceOf(introducer.address)) as bigint;
  try {
    const { request } = await worker.sdk.publicClient.simulateContract({
      address: AGENTIC, abi: AGENTIC_ABI, functionName: 'submit',
      args: [jobId, ('0x' + '33'.repeat(32)) as Hex, '0x'], account: worker.wallet.account!,
    });
    await wait(worker.sdk, await worker.wallet.writeContract(request), 'submit');
  } catch (e) {
    console.log(`   (submit skipped: ${(e as Error).message.split('\n')[0]})`);
  }
  const { request: completeReq } = await requester.sdk.publicClient.simulateContract({
    address: AGENTIC, abi: AGENTIC_ABI, functionName: 'complete',
    args: [jobId, ('0x' + '44'.repeat(32)) as Hex, '0x'], account: requester.wallet.account!,
  });
  await wait(requester.sdk, await requester.wallet.writeContract(completeReq), 'complete');

  // ── 7. Assert the introducer received their slice of the protocol fee ──
  const introAfter = (await read.usdcBalanceOf(introducer.address)) as bigint;
  const ar = (await read.getAR(arId)) as any;
  const paid = introAfter - introBefore;
  const feeBps = (await read.protocolFeeBps()) as number;
  const fee = (TIER1 * BigInt(feeBps)) / 10_000n;
  const expectedSlice = (fee * BigInt(SLICE_BPS)) / 10_000n;

  console.log('\n── Result ──');
  console.log(`   tier1 gross      ${usdc(TIER1)}`);
  console.log(`   protocol fee     ${usdc(fee)} (${feeBps} bps)`);
  console.log(`   AR slice (${SLICE_BPS}bps of fee) expected ≈ ${usdc(expectedSlice)}`);
  console.log(`   introducer Δusdc ${usdc(paid)}`);
  console.log(`   ar.paidToDate    ${usdc(BigInt(ar.paidToDate))}`);

  const ok = paid > 0n && BigInt(ar.paidToDate) > 0n;
  console.log(ok ? '\n🎉 introducer was paid — full attribution flow proven live' : '\n⛔ introducer was NOT paid');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('\nscript error:', e); process.exit(1); });
