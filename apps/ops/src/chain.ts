import { createPublicClient, createWalletClient, fallback, http, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '@echo/sdk';
import { config } from './config.js';

// Same multi-provider fallback as the indexer's chain.ts (see the incident note there): Arc has
// four independently rate-limited public endpoints; never let one provider's view of our IP take
// the dashboard's reads down. RPC_URL stays first; override the list with comma-separated RPC_URLS.
const FALLBACK_URLS = [
  'https://rpc.drpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
];
const urls = process.env.RPC_URLS
  ? process.env.RPC_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : [config.rpcUrl, ...FALLBACK_URLS.filter((u) => u !== config.rpcUrl)];

export const publicClient: PublicClient = createPublicClient({
  chain: arcTestnet as unknown as Chain,
  transport: fallback(urls.map((u) => http(u))),
});

// Local-account signer for owner-only writes. Undefined when DEPLOYER_PRIVATE_KEY is unset
// (read-only mode). Arc's public RPC rejects node-side signing, so we always sign locally.
export const ownerAccount = config.deployerKey ? privateKeyToAccount(config.deployerKey) : undefined;

export const walletClient: WalletClient | undefined = ownerAccount
  ? createWalletClient({ account: ownerAccount, chain: arcTestnet as unknown as Chain, transport: http(config.rpcUrl) })
  : undefined;

// Minimal ABIs — only the owner functions and getters the dashboard touches. Kept inline so ops is
// self-contained and doesn't depend on which ABIs the SDK happens to bundle.
export const DISPUTE_RESOLVER_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'modeAStakeEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'minBond', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'votingPeriod', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'jurorCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'disputeCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'jurors', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'setJuror', stateMutability: 'nonpayable', inputs: [{ name: 'juror', type: 'address' }, { name: 'active', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setModeAStakeEnabled', stateMutability: 'nonpayable', inputs: [{ name: 'enabled', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setConfig', stateMutability: 'nonpayable', inputs: [{ name: '_minBond', type: 'uint256' }, { name: '_votingPeriod', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'setAgentOracle', stateMutability: 'nonpayable', inputs: [{ name: '_oracle', type: 'address' }], outputs: [] },
] as const;

export const ATTRIBUTION_PAYOUT_ABI = [
  { type: 'function', name: 'feeShareCeilingBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'setCeiling', stateMutability: 'nonpayable', inputs: [{ name: '_ceilingBps', type: 'uint16' }], outputs: [] },
] as const;

export const VALIDATION_GATE_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setAttester', stateMutability: 'nonpayable', inputs: [{ name: 'attester', type: 'address' }, { name: 'allowed', type: 'bool' }], outputs: [] },
] as const;

export const OWNABLE_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;
