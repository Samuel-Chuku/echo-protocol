'use client';

import { createConfig, http } from 'wagmi';
import type { Chain } from 'viem';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  rabbyWallet,
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { arcTestnet } from '@echo/sdk';
import { circleWallet, circleConfigured } from './circle';

/**
 * One "Connect Wallet" button → a RainbowKit modal listing every wallet. We use connectorsForWallets
 * (rather than getDefaultConfig) so the Circle Modular Wallet can sit in its own "Smart Wallets" group
 * alongside the standard ones — it only appears when circleConfigured() (the NEXT_PUBLIC_CIRCLE_* env
 * vars are set; see lib/circle.ts).
 *
 * WalletConnect / mobile wallets need a (free) project id from https://cloud.reown.com →
 * NEXT_PUBLIC_WC_PROJECT_ID in apps/web/.env.local. Injected wallets work without it.
 */
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'echo_console_dev_placeholder';

const chains = [arcTestnet] as unknown as readonly [Chain, ...Chain[]];

const connectors = connectorsForWallets(
  [
    ...(circleConfigured()
      ? [{ groupName: 'Smart Wallets', wallets: [circleWallet] }]
      : []),
    {
      groupName: 'Popular',
      wallets: [injectedWallet, rabbyWallet, metaMaskWallet, coinbaseWallet, walletConnectWallet],
    },
  ],
  { appName: 'Echo Console', projectId },
);

export const config = createConfig({
  chains,
  connectors,
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
  ssr: true,
});
