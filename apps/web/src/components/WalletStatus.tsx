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

  const isPasskey = connector?.id === CIRCLE_CONNECTOR_ID;

  return (
    <div className="ml-auto flex items-center gap-2">
      {account && (
        <div className="flex flex-col items-end leading-tight">
          <span className="text-sm text-gray-700 font-medium tabular-nums">
            {usdcShort(bal)} <span className="text-xs text-gray-400 font-normal">USDC</span>
          </span>
          {isPasskey && (
            <Link href={`/u/${account}#send`} className="text-[11px] text-gray-400 hover:text-gray-700">
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
                <button onClick={() => setSignInOpen(true)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
                  Sign in
                </button>
              </div>
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
              <AvatarMenu account={account!} onAccount={openAccountModal} />
            </div>
          );
        }}
      </ConnectButton.Custom>
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

/**
 * Quick-reconnect chip for returning Circle passkey users. Webauthn can't reconnect silently on
 * refresh (it requires a user gesture for every credential challenge), so we cache the email + SCA
 * address on the first connect and offer a single-tap "Continue as 0x… →" button anywhere the
 * Sign-in button would appear. Clicking it re-runs the passkey login flow with the cached email,
 * so it's at most one Face/Touch prompt instead of opening the modal and re-typing the email.
 *
 * Hidden whenever there's no cached session, no Circle connector registered, or the Circle env
 * vars aren't configured.
 */
function ContinueAsChip() {
  const { connectors, connectAsync } = useConnect();
  const [session, setSession] = useState<ReturnType<typeof readCircleSession>>(null);
  const [busy, setBusy] = useState(false);

  // Read fresh on mount so a disconnect → forget on another tab is reflected here too.
  useEffect(() => { setSession(readCircleSession()); }, []);

  const circle = connectors.find((c) => c.id === CIRCLE_CONNECTOR_ID);
  if (!session || !circle) return null;

  async function reconnect() {
    if (!session) return; // narrows for TS — guarded by the early-return above
    setBusy(true);
    try {
      setCircleMode('login');
      setCircleUsername(session.email);
      await connectAsync({ connector: circle! });
    } catch {
      // Either the user cancelled the prompt or the cached passkey is gone. Surface a hint by
      // forgetting the session so we don't keep offering a dead chip.
      forgetCircleSession();
      setSession(null);
    } finally {
      setCircleMode(undefined);
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center rounded-md border border-gray-200 bg-white">
      <button
        onClick={reconnect}
        disabled={busy}
        title={`Sign in with the passkey for ${session.email}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Continue as <span className="font-mono">{short(session.address)}</span>
      </button>
      <button
        onClick={() => { forgetCircleSession(); setSession(null); }}
        title="Forget this passkey session"
        className="px-2 py-1.5 text-gray-400 hover:text-gray-700 border-l border-gray-200"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Deterministic colored avatar that reveals a small menu: Profile (public profile) and Account
 *  (RainbowKit modal — details / disconnect). Opens on hover (desktop) AND on click/tap (touch),
 *  closing on outside click or Escape. Replaces the standalone Profile nav button. */
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
        className="h-8 w-8 rounded-full border border-gray-200 shrink-0 ring-2 ring-transparent group-hover:ring-gray-300 aria-expanded:ring-gray-300 transition"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 75% 45%))` }}
      />
      {/* Hover (desktop) via group-hover; tap (touch) via the `open` state. pt-2 bridges the cursor gap. */}
      <div className={`absolute right-0 top-full pt-2 z-30 group-hover:block ${open ? 'block' : 'hidden'}`}>
        <div className="min-w-[150px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <Link href={`/u/${account}`} onClick={() => setOpen(false)} className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Profile</Link>
          {onAccount && (
            <button onClick={() => { setOpen(false); onAccount(); }} className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50">
              Account & disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
