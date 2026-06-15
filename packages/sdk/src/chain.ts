import { createPublicClient, http } from 'viem';

// Pure-viem chain definition + read client.
// Kept free of wagmi (a React/browser lib) so the SDK class and scripts can
// run server-side without pulling browser-only dependencies. The wagmi config
// lives in ./chains and is only needed by React apps.

// Arc Testnet chain definition (not in wagmi/viem builtins)
export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
} as const;

// Read env without depending on @types/node (the SDK is isomorphic; the RPC URL is optional —
// viem falls back to the chain's rpcUrls when undefined).
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

// viem public client for server-side / scripting
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(env.ARC_TESTNET_RPC_URL),
});
