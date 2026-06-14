'use client';

import { createConnector } from 'wagmi';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { arcTestnet } from '@echo/sdk';

/**
 * Circle Modular Wallet (Circle Smart Account) as a RainbowKit custom wallet — a passkey-signed,
 * ERC-4337 smart account that appears in the same Connect modal as Rabby/MetaMask/etc.
 *
 * STATUS: scaffold. It builds the real Circle flow (passkey → smart account → bundler → EIP-1193
 * provider → wagmi connector), but it is INERT until you provide the prerequisites below, so it
 * cannot break the build or the default wallets. Nothing imports it unless you opt in (see "ACTIVATE").
 *
 * PREREQUISITES (the open questions in CLAUDE.md):
 *   1. Circle Console → Modular Wallets → create a Client Key + Client URL. Put them in
 *      apps/web/.env.local as NEXT_PUBLIC_CIRCLE_CLIENT_KEY / NEXT_PUBLIC_CIRCLE_CLIENT_URL.
 *   2. Install the SDK:  pnpm --filter @echo/web add @circle-fin/modular-wallets-core
 *   3. VERIFY ARC SUPPORT: Circle's bundler/paymaster must support Arc testnet, and you need the
 *      chain slug used in the modular transport URL (docs use ".../polygonAmoy"). Set
 *      NEXT_PUBLIC_CIRCLE_CHAIN_SLUG to Arc's slug. If Circle doesn't support Arc yet, this wallet
 *      can't submit user-ops there — that's the one hard blocker to confirm first.
 *
 * WIRED: lib/wagmi.ts includes circleWallet() in a "Smart Wallets" group whenever circleConfigured()
 * is true (i.e. the env vars below are set). Arc is supported by Circle modular wallets
 * (chain code ARC-TESTNET, Wallets SCA), so the only setup left is: create the Client Key + URL in
 * the Circle Console and install @circle-fin/modular-wallets-core.
 */

const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
// Arc's slug in Circle's modular transport URL (the SDK uses paths like ".../polygonAmoy"). Defaults
// to 'arcTestnet'; override with NEXT_PUBLIC_CIRCLE_CHAIN_SLUG if Circle's path differs.
const CHAIN_SLUG = process.env.NEXT_PUBLIC_CIRCLE_CHAIN_SLUG || 'arcTestnet';

/** True only when the Circle keys are present — used to decide whether to show the wallet. */
export const circleConfigured = () => Boolean(CLIENT_KEY && CLIENT_URL);

/** Build the Circle Smart Account EIP-1193 provider via passkey (register/login). Dynamic-imports
 *  the Circle + viem AA SDKs so this module compiles without them installed. */
async function buildCircleProvider(): Promise<{ provider: any; address: `0x${string}` }> {
  if (!circleConfigured()) throw new Error('Circle wallet not configured (set NEXT_PUBLIC_CIRCLE_* env vars).');

  // Variable specifiers keep TypeScript from resolving these statically before they're installed.
  const corePkg = '@circle-fin/modular-wallets-core';
  const aaPkg = 'viem/account-abstraction';
  const viemPkg = 'viem';
  const core: any = await import(/* webpackIgnore: true */ corePkg);
  const aa: any = await import(/* webpackIgnore: true */ aaPkg);
  const viem: any = await import(/* webpackIgnore: true */ viemPkg);

  const passkeyTransport = core.toPasskeyTransport(CLIENT_URL, CLIENT_KEY);
  const modularTransport = core.toModularTransport(`${CLIENT_URL}/${CHAIN_SLUG}`, CLIENT_KEY);

  // Try login first; fall back to register for a first-time user.
  let credential;
  try {
    credential = await core.toWebAuthnCredential({ transport: passkeyTransport, mode: core.WebAuthnMode.Login });
  } catch {
    credential = await core.toWebAuthnCredential({ transport: passkeyTransport, mode: core.WebAuthnMode.Register, username: 'echo-console' });
  }

  const client = viem.createPublicClient({ chain: arcTestnet, transport: modularTransport });
  const smartAccount = await core.toCircleSmartAccount({ client, owner: aa.toWebAuthnAccount({ credential }) });
  const bundlerClient = aa.createBundlerClient({ account: smartAccount, chain: arcTestnet, transport: modularTransport });

  const publicClient = viem.createPublicClient({ chain: arcTestnet, transport: viem.http('https://rpc.testnet.arc.network') });
  const provider = new core.EIP1193Provider(bundlerClient, publicClient);
  return { provider, address: smartAccount.address as `0x${string}` };
}

/**
 * RainbowKit custom wallet (a wallet-creator function, per connectorsForWallets) wrapping the Circle
 * provider in a minimal wagmi connector. connect() runs the passkey flow and caches the provider; the
 * rest delegate to it. Verify the EIP1193Provider export + chain slug against your Circle SDK version.
 */
export const circleWallet = (): Wallet => ({
  id: 'circle-smart-account',
  name: 'Circle Wallet (passkey)',
  iconBackground: '#0A0B0D',
  iconUrl: async () => 'https://www.circle.com/favicon.ico',
  createConnector: (rkDetails) =>
    createConnector((config) => {
      let provider: any;
      let address: `0x${string}` | undefined;

      return {
        ...rkDetails,
        id: 'circle-smart-account',
        name: 'Circle Wallet (passkey)',
        type: 'circle' as const,

        async connect() {
          const built = await buildCircleProvider();
          provider = built.provider;
          address = built.address;
          config.emitter.emit('connect', { accounts: [address], chainId: arcTestnet.id });
          return { accounts: [address] as readonly `0x${string}`[], chainId: arcTestnet.id };
        },
        async disconnect() {
          provider = undefined;
          address = undefined;
        },
        async getAccounts() {
          return address ? ([address] as readonly `0x${string}`[]) : [];
        },
        async getChainId() {
          return arcTestnet.id;
        },
        async getProvider() {
          if (!provider) ({ provider, address } = await buildCircleProvider());
          return provider;
        },
        async isAuthorized() {
          return Boolean(address);
        },
        onAccountsChanged() {},
        onChainChanged() {},
        onDisconnect() {
          config.emitter.emit('disconnect');
        },
      };
    }),
});
