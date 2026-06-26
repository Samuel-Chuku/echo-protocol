'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useEcho } from '@/lib/sdk';
import { usdcShort } from '@/lib/format';
import { Bell } from './Bell';
import { SignInModal } from './SignInModal';

/**
 * Right-side wallet cluster in the nav: USDC balance (next to the wallet), the notification bell, the
 * connect/account control (our custom sign-in modal when disconnected), and a colored profile avatar
 * linking to the connected wallet's profile.
 */
export function WalletStatus() {
  const { sdk, account } = useEcho();
  const [bal, setBal] = useState<bigint>();
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    if (!account) { setBal(undefined); return; }
    let active = true;
    sdk.usdcBalanceOf(account).then((b) => { if (active) setBal(b as bigint); }).catch(() => {});
    return () => { active = false; };
  }, [sdk, account]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {account && (
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-success shrink-0" title="Connected" />
          <span className="text-sm text-white font-medium tabular-nums">
            {usdcShort(bal)} <span className="text-xs text-white/40 font-normal">USDC</span>
          </span>
        </span>
      )}
      <Bell />
      <ConnectButton.Custom>
        {({ account: acc, chain, openAccountModal, openChainModal, mounted }) => {
          if (!mounted) return null;
          if (!acc) {
            return (
              <button onClick={() => setSignInOpen(true)} className="rounded-full bg-teal-500 px-3.5 py-1.5 min-h-[44px] text-sm font-semibold text-ink hover:bg-teal-400 transition">
                Sign in
              </button>
            );
          }
          if (chain?.unsupported) {
            return (
              <button onClick={openChainModal} className="rounded-full bg-danger px-3.5 py-1.5 min-h-[44px] text-sm font-medium text-white hover:bg-danger/80 transition">
                Wrong network
              </button>
            );
          }
          return (
            <button onClick={openAccountModal} className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 min-h-[44px] text-sm font-medium text-white hover:bg-white/[0.08] transition">
              {acc.displayName}
            </button>
          );
        }}
      </ConnectButton.Custom>
      {account && <ProfileAvatar account={account} />}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}

/** Deterministic colored avatar (gradient seeded from the address) linking to the user's profile. */
function ProfileAvatar({ account }: { account: `0x${string}` }) {
  const hue = parseInt(account.slice(2, 8), 16) % 360;
  return (
    <Link
      href={`/u/${account}`}
      title="Your profile"
      aria-label="Your profile"
      className="h-8 w-8 rounded-full border border-white/10 shrink-0 ring-2 ring-transparent hover:ring-teal-500/40 transition"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 75% 45%))` }}
    />
  );
}
