'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { EchoSdk } from '@echo/sdk';
import type { Address } from 'viem';

/**
 * Single entry point the whole console uses. wagmi/RainbowKit own the connection; the EchoSdk owns
 * the contract calls and signs through **the active connector's** EIP-1193 provider — not
 * window.ethereum. That distinction matters: window.ethereum only exists for injected wallets, so
 * pulling the provider from the connector is what makes Coinbase smart wallet / WalletConnect / the
 * Circle modular wallet sign Echo transactions too.
 *
 * `account` is the connected address you pass to every write method.
 */
export function useEcho(): { sdk: EchoSdk; account?: Address; isConnected: boolean; walletReady: boolean } {
  const { address, isConnected, connector } = useAccount();

  const sdk = useMemo(() => new EchoSdk(), []);
  // `walletReady` flips true only once the SDK's walletClient is actually wired to the connector's
  // provider. Auth's auto-sign-in waits on this so it never calls signMessage before the wallet can
  // sign (which would throw "Wallet not connected" right after connect).
  const [walletReady, setWalletReady] = useState(false);

  useEffect(() => {
    let active = true;
    setWalletReady(false);
    (async () => {
      if (!connector || !isConnected) return;
      try {
        const provider = await connector.getProvider();
        if (active && provider) {
          sdk.connectWallet(provider);
          setWalletReady(true);
        }
      } catch {
        /* connector has no provider yet — ignore until connected */
      }
    })();
    return () => { active = false; };
  }, [connector, isConnected, sdk]);

  return { sdk, account: address as Address | undefined, isConnected, walletReady };
}
