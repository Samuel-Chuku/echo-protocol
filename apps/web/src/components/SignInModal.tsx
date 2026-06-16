'use client';

import { useState } from 'react';
import { Mail, Wallet, X, ArrowRight, Loader2 } from 'lucide-react';
import { useConnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { CIRCLE_CONNECTOR_ID, circleConfigured, setCircleUsername } from '@/lib/circle';

/**
 * Sign-in modal with two distinct paths (the Karwan pattern, #5):
 *  - "Continue with email" → Circle Modular Wallet (passkey smart account). The email becomes the
 *    passkey username on first register; returning users just present their passkey.
 *  - "Connect a wallet" → the RainbowKit modal (Rabby/MetaMask/Coinbase/WalletConnect).
 * The Circle path only shows when the Circle keys are configured.
 */
export function SignInModal({ onClose }: { onClose: () => void }) {
  const { connectAsync, connectors } = useConnect();
  const { openConnectModal } = useConnectModal();
  const [emailStep, setEmailStep] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const circle = connectors.find((c) => c.id === CIRCLE_CONNECTOR_ID);
  const showCircle = circleConfigured() && !!circle;

  async function continueWithEmail() {
    if (!emailStep) { setEmailStep(true); return; }
    setErr('');
    setBusy(true);
    try {
      setCircleUsername(email.trim());
      await connectAsync({ connector: circle! });
      onClose();
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Passkey sign-in failed.');
      setBusy(false);
    }
  }

  function connectWallet() {
    onClose();
    openConnectModal?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Welcome</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>

        <h2 className="mt-3 text-xl font-bold">Sign in to Echo</h2>
        <p className="mt-1 text-sm text-gray-500">Echo identifies you by a wallet. Pick a path — we provision the rest.</p>

        <div className="mt-5 space-y-3">
          {showCircle && (
            emailStep ? (
              <div className="rounded-xl border border-gray-200 p-3">
                <label className="block">
                  <span className="text-xs font-medium text-gray-500">Email</span>
                  <input
                    type="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') continueWithEmail(); }}
                    placeholder="you@example.com"
                    className="mt-0.5 w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 focus:border-gray-500 focus:outline-none"
                  />
                </label>
                <button
                  onClick={continueWithEmail}
                  disabled={busy}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {busy ? 'Creating your passkey…' : 'Continue'}
                </button>
                <p className="mt-1.5 text-xs text-gray-400">You&apos;ll be asked for a passkey (Face/Touch/PIN). No password.</p>
              </div>
            ) : (
              <button
                onClick={continueWithEmail}
                className="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-700"
              >
                <span className="inline-flex items-center gap-2"><Mail className="w-4 h-4" /> Continue with email</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )
          )}

          {showCircle && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200" /> OR <span className="h-px flex-1 bg-gray-200" />
            </div>
          )}

          <button
            onClick={connectWallet}
            className="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <span className="inline-flex items-center gap-2"><Wallet className="w-4 h-4" /> Connect a wallet</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {err && <p className="mt-3 text-xs text-red-600 break-all">{err}</p>}
      </div>
    </div>
  );
}
