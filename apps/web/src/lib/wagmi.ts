'use client';

import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arcTestnet } from '@echo/sdk';

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [injected({ target: 'metaMask' })],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
});
