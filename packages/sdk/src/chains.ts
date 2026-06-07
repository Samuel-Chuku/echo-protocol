import { http, createConfig } from 'wagmi';
import { createPublicClient, createWalletClient, custom } from 'viem';

// Arc Testnet chain definition (not in wagmi builtins)
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

// wagmi config for React
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(),
  },
});

// viem public client for server-side / scripting
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.ARC_TESTNET_RPC_URL),
});

// viem wallet client (needs window.ethereum)
export const walletClient = typeof window !== 'undefined'
  ? createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum!) })
  : null;
