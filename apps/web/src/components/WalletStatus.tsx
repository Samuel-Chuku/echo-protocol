'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBlockNumber, useSwitchChain } from 'wagmi';
import { arcTestnet } from '@echo/sdk';
import { useConnect } from 'wagmi';
import { Loader2, X } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { usdcShort, short } from '@/lib/format';
import { CIRCLE_CONNECTOR_ID, forgetCircleSession, readCircleSession, setCircleMode, setCircleUsername } from '@/lib/circle';
import { Bell } from './Bell';
import { SignInModal } from './SignInModal';
import { UsdcMark } from './ui';

/**
 * Right-side wallet cluster in the nav: USDC balance (auto-refreshing), the notification bell, an
 * active-chain pill / wrong-network switcher, the connect/account control (custom sign-in modal when
 * disconnected, copy-on-click address chip when connected), and a colored avatar that opens a small
 * menu (Profile + Account & disconnect) on hover (desktop) or tap (mobile).
 */
export function WalletStatus() {
  const { sdk, account } = useEcho();
  const { chainId, connector, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const [bal, setBal] = useState<bigint>();
  const [signInOpen, setSignInOpen] = useState(false);

  // Keep the nav balance live: refetch on every new block and on a 10s floor.
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

  // Auto-prompt a switch to Arc when connected on an unsupported chain. Circle is single-chain, skip it.
  useEffect(() => {
    if (!isConnected || !chainId || chainId === arcTestnet.id) return;
    if (connector?.id === CIRCLE_CONNECTOR_ID) return;
    switchChain({ chainId: arcTestnet.id });
  }, [isConnected, chainId, connector?.id, switchChain]);

  const isPasskey = connector?.id === CIRCLE_CONNECTOR_ID;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {account && (
        <div className="flex flex-col items-end leading-tight">
          <span className="inline-flex items-center gap-1 text-sm text-white font-medium tabular-nums">
            <UsdcMark className="h-4 w-4" />
            {usdcShort(bal)} <span className="text-xs text-white/40 font-normal">USDC</span>
          </span>
          {isPasskey && (
            <Link href={`/u/${account}#send`} className="text-[11px] text-white/40 hover:text-white transition">
              Send to another wallet
            </Link>
          )}
        </div>
      )}
      <Bell />
      <ConnectButton.Custom>
        {({ account: acc, chain, openAccountModal, openChainModal, mounted }) => {
          if (!mounted) return null;
          if (!acc) {
            return (
              <div className="flex items-center gap-2">
                <ContinueAsChip />
                <button onClick={() => setSignInOpen(true)} className="rounded-full bg-teal-500 px-3.5 py-1.5 min-h-[44px] text-sm font-semibold text-ink hover:bg-teal-400 transition">
                  Sign in
                </button>
              </div>
            );
          }
          if (chain?.unsupported) {
            return (
              <button
                onClick={() => switchChain({ chainId: arcTestnet.id }, { onError: openChainModal })}
                className="rounded-full bg-danger px-3.5 py-1.5 min-h-[44px] text-sm font-medium text-white hover:bg-danger/80 transition"
              >
                Wrong network
              </button>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <CopyChip account={account!} displayName={acc.displayName} />
              <AvatarMenu account={account!} onAccount={openAccountModal} />
            </div>
          );
        }}
      </ConnectButton.Custom>
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}

/** Truncated address chip: click copies the full address and flashes "Copied". */
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
      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.08] tabular-nums transition"
    >
      {copied ? 'Copied' : displayName}
    </button>
  );
}

/**
 * Quick-reconnect chip for returning Circle passkey users. Caches the email + SCA address on first
 * connect and offers a single-tap "Continue as 0x..." button. Hidden when no cached session.
 */
function ContinueAsChip() {
  const { connectors, connectAsync } = useConnect();
  const [session, setSession] = useState<ReturnType<typeof readCircleSession>>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSession(readCircleSession()); }, []);

  const circle = connectors.find((c) => c.id === CIRCLE_CONNECTOR_ID);
  if (!session || !circle) return null;

  async function reconnect() {
    if (!session) return;
    setBusy(true);
    try {
      setCircleMode('login');
      setCircleUsername(session.email);
      await connectAsync({ connector: circle! });
    } catch {
      forgetCircleSession();
      setSession(null);
    } finally {
      setCircleMode(undefined);
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04]">
      <button
        onClick={reconnect}
        disabled={busy}
        title={`Sign in with the passkey for ${session.email}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.04] disabled:opacity-60 transition"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Continue as <span className="font-mono">{short(session.address)}</span>
      </button>
      <button
        onClick={() => { forgetCircleSession(); setSession(null); }}
        title="Forget this passkey session"
        className="px-2 py-1.5 text-white/40 hover:text-white border-l border-white/10 transition"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Deterministic colored avatar that reveals a small menu: Profile and Account (disconnect). */
function AvatarMenu({ account, onAccount }: { account: `0x${string}`; onAccount?: () => void }) {
  const hue = parseInt(account.slice(2, 8), 16) % 360;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative group">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Account menu"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 w-8 rounded-full border border-white/10 shrink-0 ring-2 ring-transparent group-hover:ring-teal-500/40 aria-expanded:ring-teal-500/40 transition"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 75% 45%))` }}
      />
      <div className={`absolute right-0 top-full pt-2 z-30 group-hover:block ${open ? 'block' : 'hidden'}`}>
        <div className="min-w-[150px] rounded-xl border border-white/10 bg-[#0d2d4a] py-1 shadow-xl">
          <Link href={`/u/${account}`} onClick={() => setOpen(false)} className="block px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/[0.04]">Profile</Link>
          {onAccount && (
            <button onClick={() => { setOpen(false); onAccount(); }} className="block w-full px-3 py-1.5 text-left text-sm text-white/70 hover:text-white hover:bg-white/[0.04]">
              Account & disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
