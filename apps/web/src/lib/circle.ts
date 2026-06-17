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

// Explicit intent from the sign-in modal: 'register' = new user (create a passkey), 'login' = returning
// user (present an existing passkey). undefined = legacy auto (try login, then register).
export type CircleMode = 'register' | 'login';
let pendingMode: CircleMode | undefined;
export function setCircleMode(mode: CircleMode | undefined) { pendingMode = mode; }

/** Build the Circle Smart Account EIP-1193 provider via passkey (login, else register). Dynamic-imports
 *  the Circle + viem AA SDKs so the connector module stays light and SSR-safe. */
async function buildCircleProvider(username?: string): Promise<{ provider: any; address: `0x${string}` }> {
  if (!circleConfigured()) throw new Error('Circle wallet not configured (set NEXT_PUBLIC_CIRCLE_* env vars).');

  const core: any = await import('@circle-fin/modular-wallets-core');
  const aa: any = await import('viem/account-abstraction');
  const viem: any = await import('viem');

  const passkeyTransport = core.toPasskeyTransport(CLIENT_URL, CLIENT_KEY);
  const modularTransport = core.toModularTransport(`${CLIENT_URL}/${CHAIN_SLUG}`, CLIENT_KEY);

  // Resolve the passkey credential by explicit intent:
  //  - 'login'    → present an existing passkey only (no silent account creation).
  //  - 'register' → create a new passkey under the email username.
  //  - undefined  → legacy auto: try login, fall back to register.
  let credential;
  if (pendingMode === 'login') {
    credential = await core.toWebAuthnCredential({ transport: passkeyTransport, mode: core.WebAuthnMode.Login });
  } else if (pendingMode === 'register') {
    credential = await core.toWebAuthnCredential({
      transport: passkeyTransport, mode: core.WebAuthnMode.Register, username: username || 'echo-user',
    });
  } else {
    try {
      credential = await core.toWebAuthnCredential({ transport: passkeyTransport, mode: core.WebAuthnMode.Login });
    } catch {
      credential = await core.toWebAuthnCredential({
        transport: passkeyTransport, mode: core.WebAuthnMode.Register, username: username || 'echo-user',
      });
    }
  }

  const client = viem.createPublicClient({ chain: arcTestnet, transport: modularTransport });
  const smartAccount = await core.toCircleSmartAccount({ client, owner: aa.toWebAuthnAccount({ credential }) });

  // Arc's bundler returns gas prices as a TIERED object via `circle_getUserOperationGasPrice`
  // ({ low|medium|high: { maxFeePerGas, maxPriorityFeePerGas } } as hex strings), not flat fee
  // fields. Without a custom fee hook, viem's generic estimateFeesPerGas receives that object and
  // does `BigInt({...})` → "Cannot convert [object Object] to a BigInt" (the register failure). The
  // `userOperation.estimateFeesPerGas` hook below mirrors Circle's quickstart: read the tier and
  // convert with hexToBigInt.
  const estimateFeesPerGas = async ({ bundlerClient }: any) => {
    const price = await bundlerClient.request({ method: 'circle_getUserOperationGasPrice', params: [] });
    // Temporary signal so we can confirm the new fee hook is actually running (vs a stale cached
    // provider). Remove once register works.
    // eslint-disable-next-line no-console
    console.log('[circle] estimateFeesPerGas hook running; gas price tiers =', price);
    const tier = price.medium ?? price.high ?? price.low;
    return {
      maxFeePerGas: viem.hexToBigInt(tier.maxFeePerGas),
      maxPriorityFeePerGas: viem.hexToBigInt(tier.maxPriorityFeePerGas),
    };
  };

  // `paymaster: true` routes every userOp through the Circle Paymaster (Gas Station). viem's
  // prepareUserOperation honours this client-level default. Sponsorship still requires a Gas Station
  // policy enabled for Arc Testnet on this client key (the wrapper below logs the real reason if not).
  const bundlerClient = aa.createBundlerClient({
    account: smartAccount,
    chain: arcTestnet,
    transport: modularTransport,
    paymaster: true,
    userOperation: { estimateFeesPerGas },
  });

  const publicClient = viem.createPublicClient({ chain: arcTestnet, transport: viem.http('https://rpc.testnet.arc.network') });
  const provider = wrapWithDiagnostics(new core.EIP1193Provider(bundlerClient, publicClient));
  return { provider, address: smartAccount.address as `0x${string}` };
}

/**
 * Adapt Circle's `EIP1193Provider` to the EIP-1193 contract viem's `custom()` transport expects.
 *
 * Despite its name, Circle's provider is web3.js-style: every `request()` resolves to a full
 * JSON-RPC *response object* `{ jsonrpc, id, result }` (and `{ ..., error }` on failure). viem's
 * `custom()` transport — like EIP-1193 — expects `request()` to return the RAW result (or throw).
 * Without unwrapping, viem feeds the whole object into e.g. `hexToNumber` for `eth_chainId`, which
 * does `BigInt({...})` → "Cannot convert [object Object] to a BigInt", killing every Circle write
 * before it leaves the browser. We unwrap `.result` (throwing `.error`) so viem gets a conformant
 * provider.
 */
function wrapWithDiagnostics(provider: any): any {
  const orig = provider.request.bind(provider);
  provider.request = async (payload: any) => {
    const res = await orig(payload);
    // Only unwrap genuine JSON-RPC envelopes; pass anything already-raw straight through.
    if (res && typeof res === 'object' && 'jsonrpc' in res && ('result' in res || 'error' in res)) {
      if (res.error) throw res.error;
      return res.result;
    }
    return res;
  };
  return provider;
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

      async connect(params?: { isReconnecting?: boolean }) {
        // Never trigger the passkey/WebAuthn prompt during wagmi's auto-reconnect on page load — it
        // must only fire from an explicit "Continue with email" click. wagmi catches this throw and
        // silently drops the connector from the reconnect attempt.
        if (params?.isReconnecting) throw new Error('Circle passkey sign-in must be explicit');
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
        // Return only the provider cached by an explicit connect(); never build here, or a stray
        // getProvider() call (e.g. during reconnect) would pop the passkey dialog on page load.
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
