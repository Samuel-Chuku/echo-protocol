/**
 * Empirically probe the LIVE Arc primitives to confirm/deny the interface
 * mismatch that broke the e2e. Read-only, no keys needed.
 *
 * For each primitive we (a) pull the verified ABI from the Blockscout-style
 * explorer (proxy → implementation), and (b) directly call the functions Echo's
 * contracts assume exist, to see if they revert.
 *
 * Run from packages/sdk:
 *   node ../../node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs scripts/probe-arc.ts
 */
import { createPublicClient, http, type Address } from 'viem';
import { CONTRACTS } from '../src/index';

const RPC = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
const EXPLORER = 'https://testnet.arcscan.app/api';
const C = CONTRACTS.arcTestnet;

const client = createPublicClient({ transport: http(RPC) });

const IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

async function implOf(addr: Address): Promise<Address> {
  const raw = await client.getStorageAt({ address: addr, slot: IMPL_SLOT });
  if (!raw || raw === `0x${'0'.repeat(64)}`) return addr; // not a proxy
  return (`0x${raw.slice(-40)}`) as Address;
}

async function fetchAbi(addr: Address): Promise<any[] | null> {
  const url = `${EXPLORER}?module=contract&action=getabi&address=${addr}`;
  try {
    const r = await fetch(url);
    const j: any = await r.json();
    if (j.status === '1' && j.result) return JSON.parse(j.result);
  } catch (e) {
    console.log(`   (abi fetch failed: ${(e as Error).message})`);
  }
  return null;
}

function funcNames(abi: any[]): string[] {
  return abi
    .filter((x) => x.type === 'function')
    .map((f) => {
      const ins = (f.inputs || []).map((i: any) => i.type).join(',');
      const outs = (f.outputs || []).map((o: any) => o.type).join(',');
      return `${f.name}(${ins})${outs ? `→${outs}` : ''}`;
    })
    .sort();
}

/** Try a raw call; report whether it reverts. */
async function tryCall(
  label: string,
  address: Address,
  abi: any[],
  functionName: string,
  args: any[]
) {
  try {
    const out = await client.readContract({ address, abi: abi as any, functionName, args });
    console.log(`   ✅ ${label} → ${JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    console.log(`   ❌ ${label} REVERTS/absent → ${msg}`);
  }
}

const MINI = {
  agentIdOf: [{ type: 'function', name: 'agentIdOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
  ownerOf: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }],
  balanceOf: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
  supportsInterface: [{ type: 'function', name: 'supportsInterface', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] }],
  jobCounter: [{ type: 'function', name: 'jobCounter', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
} as const;

async function section(title: string, proxy: Address) {
  console.log(`\n━━━ ${title}  ${proxy} ━━━`);
  const impl = await implOf(proxy);
  console.log(`   impl: ${impl}`);
  const abi = await fetchAbi(impl);
  if (abi) {
    console.log(`   verified functions (${abi.filter((x) => x.type === 'function').length}):`);
    for (const f of funcNames(abi)) console.log(`     · ${f}`);
  } else {
    console.log('   (no verified ABI from explorer — will rely on direct calls)');
  }
  return { impl, abi };
}

async function main() {
  console.log(`RPC ${RPC}\nchainId ${await client.getChainId()}`);

  // ── IDENTITY ──
  await section('IdentityRegistry (ERC-8004)', C.identityRegistry);
  console.log('   Echo assumes agentIdOf(address). Testing:');
  await tryCall('agentIdOf(0x00..01)', C.identityRegistry, MINI.agentIdOf, 'agentIdOf', ['0x0000000000000000000000000000000000000001']);
  await tryCall('balanceOf(0x00..01)', C.identityRegistry, MINI.balanceOf, 'balanceOf', ['0x0000000000000000000000000000000000000001']);
  await tryCall('ownerOf(1)', C.identityRegistry, MINI.ownerOf, 'ownerOf', [1n]);
  // ERC721 = 0x80ac58cd, Enumerable = 0x780e9d63
  await tryCall('supportsInterface(ERC721)', C.identityRegistry, MINI.supportsInterface, 'supportsInterface', ['0x80ac58cd']);
  await tryCall('supportsInterface(Enumerable)', C.identityRegistry, MINI.supportsInterface, 'supportsInterface', ['0x780e9d63']);

  // ── REPUTATION ──
  await section('ReputationRegistry (ERC-8004)', C.reputationRegistry);

  // ── AGENTIC COMMERCE ──
  const { abi: acAbi } = await section('AgenticCommerce (ERC-8183)', C.agenticCommerce);
  await tryCall('jobCounter()', C.agenticCommerce, MINI.jobCounter, 'jobCounter', []);
  if (acAbi) {
    const hookHints = funcNames(acAbi).filter((n) => /hook|whitelist|action|register/i.test(n));
    console.log('   hook/whitelist-related:', hookHints.length ? hookHints : '(none found by name)');
  }
}

main().catch((e) => { console.error('script error:', e); process.exit(1); });
