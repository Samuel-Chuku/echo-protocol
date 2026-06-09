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

// viem public client for server-side / scripting
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.ARC_TESTNET_RPC_URL),
});
