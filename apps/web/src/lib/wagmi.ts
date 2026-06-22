'use client';

import { createConfig, createStorage, cookieStorage, http } from 'wagmi';
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
import { circleConnector, circleConfigured } from './circle';

/**
 * Two distinct sign-in paths (see components/SignInModal):
 *  - "Connect a wallet" → the RainbowKit modal listing Rabby/MetaMask/Coinbase/WalletConnect.
 *  - "Continue with email" → the Circle Modular Wallet (passkey smart account), registered here as a
 *    standalone wagmi connector OUTSIDE the RainbowKit list, only when circleConfigured().
 *
 * WalletConnect / mobile wallets need a (free) project id from https://cloud.reown.com →
 * NEXT_PUBLIC_WC_PROJECT_ID in apps/web/.env.local. Injected wallets work without it.
 */
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'echo_console_dev_placeholder';

const chains = [arcTestnet] as unknown as readonly [Chain, ...Chain[]];

const rainbowConnectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [injectedWallet, rabbyWallet, metaMaskWallet, coinbaseWallet, walletConnectWallet],
    },
  ],
  { appName: 'Echo Console', projectId },
);

// Circle sits alongside (not inside) the RainbowKit connectors so it can be its own modal option.
const connectors = circleConfigured() ? [circleConnector(), ...rainbowConnectors] : rainbowConnectors;

// Persist connection state to cookies so it survives refresh + Next.js SSR hydration. Without
// this, wagmi v2 + `ssr: true` loses connector state between renders and randomly disconnects
// the wallet mid-click. Cookies (not localStorage) so SSR has the state available on first paint.
export const config = createConfig({
  chains,
  connectors,
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
