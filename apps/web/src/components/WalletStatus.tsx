'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBlockNumber, useSwitchChain } from 'wagmi';
import { arcTestnet } from '@echo/sdk';
import { useEcho } from '@/lib/sdk';
import { usdcShort } from '@/lib/format';
import { CIRCLE_CONNECTOR_ID } from '@/lib/circle';
import { Bell } from './Bell';
import { SignInModal } from './SignInModal';

/**
 * Right-side wallet cluster in the nav: USDC balance (auto-refreshing), the notification bell, an
 * active-chain pill / wrong-network switcher, the connect/account control (custom sign-in modal when
 * disconnected, copy-on-click address chip when connected), an explicit Profile button, and a colored
 * avatar that opens the account modal.
 */
export function WalletStatus() {
  const { sdk, account } = useEcho();
  const { chainId, connector, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const [bal, setBal] = useState<bigint>();
  const [signInOpen, setSignInOpen] = useState(false);

  // #1 — keep the nav balance live: refetch on every new block (a tx mines one, so the balance
  // updates right after a transaction) and on a 10s floor in case block-watching is idle.
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const refresh = useCallback(() => {
    if (!account) { setBal(undefined); return; }
    sdk.usdcBalanceOf(account).then((b) => setBal(b as bigint)).catch(() => {});
  }, [sdk, account]);

  useEffect(() => { refresh(); }, [refresh, blockNumber]);
  useEffect(() => {
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  // #4 — auto-prompt a switch to Arc when connected on an unsupported chain. The Circle smart account
  // is single-chain (always Arc) and can't switch, so skip it.
  useEffect(() => {
    if (!isConnected || !chainId || chainId === arcTestnet.id) return;
    if (connector?.id === CIRCLE_CONNECTOR_ID) return;
    switchChain({ chainId: arcTestnet.id });
  }, [isConnected, chainId, connector?.id, switchChain]);

  return (
    <div className="ml-auto flex items-center gap-2">
      {account && (
        <span className="text-sm text-gray-700 font-medium tabular-nums">
          {usdcShort(bal)} <span className="text-xs text-gray-400 font-normal">USDC</span>
        </span>
      )}
      <Bell />
      <ConnectButton.Custom>
        {({ account: acc, chain, openAccountModal, openChainModal, mounted }) => {
          if (!mounted) return null;
          if (!acc) {
            return (
              <button onClick={() => setSignInOpen(true)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
                Sign in
              </button>
            );
          }
          if (chain?.unsupported) {
            return (
              <button
                onClick={() => switchChain({ chainId: arcTestnet.id }, { onError: openChainModal })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Wrong network — Switch to Arc
              </button>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {chain?.name ?? arcTestnet.name}
              </span>
              <CopyChip account={account!} displayName={acc.displayName} />
              {openAccountModal && <ProfileAvatar onClick={openAccountModal} account={account!} />}
            </div>
          );
        }}
      </ConnectButton.Custom>
      {account && (
        <Link
          href={`/u/${account}`}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200"
        >
          Profile
        </Link>
      )}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}

/** #5 — the truncated address chip: click copies the full address and flashes "Copied". */
function CopyChip({ account, displayName }: { account: `0x${string}`; displayName: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(account).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      title="Copy address"
      className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 tabular-nums"
    >
      {copied ? 'Copied' : displayName}
    </button>
  );
}

/** Deterministic colored avatar (gradient seeded from the address). Opens the account modal
 *  (details / disconnect); the dedicated Profile button links to the public profile. */
function ProfileAvatar({ account, onClick }: { account: `0x${string}`; onClick: () => void }) {
  const hue = parseInt(account.slice(2, 8), 16) % 360;
  return (
    <button
      onClick={onClick}
      title="Account"
      aria-label="Account"
      className="h-8 w-8 rounded-full border border-gray-200 shrink-0 ring-2 ring-transparent hover:ring-gray-300 transition"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 75% 45%))` }}
    />
  );
}
