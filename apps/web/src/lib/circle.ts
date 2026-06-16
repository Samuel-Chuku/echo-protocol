'use client';

import { createConnector } from 'wagmi';
import { arcTestnet } from '@echo/sdk';

/**
 * Circle Modular Wallet (Circle Smart Account) as a STANDALONE wagmi connector — a passkey-signed,
 * ERC-4337 smart account offered as its own sign-in path (the "Continue with email" option in
 * SignInModal), separate from the RainbowKit wallet list. Everything still flows through wagmi, so
 * useEcho / the rest of the app treat it like any other connected account.
 *
 * PREREQUISITES (env in apps/web/.env.local):
 *   NEXT_PUBLIC_CIRCLE_CLIENT_KEY / NEXT_PUBLIC_CIRCLE_CLIENT_URL — Circle Console → Modular Wallets.
 *   NEXT_PUBLIC_CIRCLE_CHAIN_SLUG — Arc's slug in Circle's modular transport URL (default 'arcTestnet').
 * The connector is only registered when circleConfigured() is true, so missing keys can't break boot.
 */

const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
const CHAIN_SLUG = process.env.NEXT_PUBLIC_CIRCLE_CHAIN_SLUG || 'arcTestnet';

export const CIRCLE_CONNECTOR_ID = 'circle-smart-account';

/** True only when the Circle keys are present — gates whether the email/passkey path is shown. */
export const circleConfigured = () => Boolean(CLIENT_KEY && CLIENT_URL);

// The email a user typed in "Continue with email" — used as the passkey username on first register.
let pendingUsername: string | undefined;
export function setCircleUsername(name: string) { pendingUsername = name || undefined; }

/** Build the Circle Smart Account EIP-1193 provider via passkey (login, else register). Dynamic-imports
 *  the Circle + viem AA SDKs so the connector module stays light and SSR-safe. */
async function buildCircleProvider(username?: string): Promise<{ provider: any; address: `0x${string}` }> {
  if (!circleConfigured()) throw new Error('Circle wallet not configured (set NEXT_PUBLIC_CIRCLE_* env vars).');

  const core: any = await import('@circle-fin/modular-wallets-core');
  const aa: any = await import('viem/account-abstraction');
  const viem: any = await import('viem');

  const passkeyTransport = core.toPasskeyTransport(CLIENT_URL, CLIENT_KEY);
  const modularTransport = core.toModularTransport(`${CLIENT_URL}/${CHAIN_SLUG}`, CLIENT_KEY);

  // Returning users log in with their existing passkey; first-timers register one under their email.
  let credential;
  try {
    credential = await core.toWebAuthnCredential({ transport: passkeyTransport, mode: core.WebAuthnMode.Login });
  } catch {
    credential = await core.toWebAuthnCredential({
      transport: passkeyTransport, mode: core.WebAuthnMode.Register, username: username || 'echo-user',
    });
  }

  const client = viem.createPublicClient({ chain: arcTestnet, transport: modularTransport });
  const smartAccount = await core.toCircleSmartAccount({ client, owner: aa.toWebAuthnAccount({ credential }) });
  const bundlerClient = aa.createBundlerClient({ account: smartAccount, chain: arcTestnet, transport: modularTransport });

  const publicClient = viem.createPublicClient({ chain: arcTestnet, transport: viem.http('https://rpc.testnet.arc.network') });
  const provider = new core.EIP1193Provider(bundlerClient, publicClient);
  return { provider, address: smartAccount.address as `0x${string}` };
}

/**
 * Standalone wagmi connector wrapping the Circle provider. connect() runs the passkey flow and caches
 * the provider; the rest delegate to it. Register it directly in createConfig (see lib/wagmi.ts).
 */
export function circleConnector() {
  return createConnector((config) => {
    let provider: any;
    let address: `0x${string}` | undefined;

    return {
      id: CIRCLE_CONNECTOR_ID,
      name: 'Circle Wallet (passkey)',
      type: 'circle' as const,

      async connect() {
        const built = await buildCircleProvider(pendingUsername);
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
        if (!provider) ({ provider, address } = await buildCircleProvider(pendingUsername));
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
      // Cast: wagmi's CreateConnectorFn return type churns across versions (the `withCapabilities`
      // generic on connect()); this connector uses a fixed shape.
    } as any;
  });
}
