'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { arcTestnet } from '@echo/sdk';
import { ArcMark } from './ui';

/**
 * Nav chain indicator. Echo only supports Arc, so this is binary:
 *   • connected & on Arc  → small Arc mark + green "live" dot + "Arc"
 *   • connected, wrong chain → amber "Switch to Arc" pill that triggers the switch
 * Hidden while disconnected (the sign-in control already covers that state).
 */
export function ChainBadge() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return null;

  if (chainId === arcTestnet.id) {
    return (
      <span
        title="Connected to Arc"
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] pl-2 pr-2.5 py-1 text-xs font-medium text-white/70"
      >
        <ArcMark className="h-3.5 w-3.5 text-white/80" />
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        Arc
      </span>
    );
  }

  return (
    <button
      onClick={() => switchChain({ chainId: arcTestnet.id })}
      disabled={isPending}
      title="Your wallet is on the wrong network — switch to Arc"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-60 transition"
    >
      <ArcMark className="h-3.5 w-3.5" />
      {isPending ? 'Switching…' : 'Switch to Arc'}
    </button>
  );
}
