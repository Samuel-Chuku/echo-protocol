import { http, createConfig } from 'wagmi';
import { createWalletClient, custom } from 'viem';

// wagmi/browser bindings for React apps. The pure-viem chain definition and
// read client live in ./chain so the SDK class can be used server-side without
// pulling wagmi. Re-export them here for back-compat with existing imports.
import { arcTestnet, publicClient } from './chain';

export { arcTestnet, publicClient };

// wagmi config for React
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(),
  },
});

// viem wallet client (needs window.ethereum)
export const walletClient = typeof window !== 'undefined'
  ? createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum!) })
  : null;
