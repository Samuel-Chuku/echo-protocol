'use client';

import { useState } from 'react';
import { Mail, Wallet, ArrowRight, Loader2 } from 'lucide-react';
import { useConnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { CIRCLE_CONNECTOR_ID, circleConfigured, setCircleUsername, setCircleMode, type CircleMode } from '@/lib/circle';
import { Modal } from './Modal';
import { INPUT_CLASS } from './ui';

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

  const [mode, setMode] = useState<CircleMode>('register');

  // mode === 'register' → create a brand-new passkey wallet (email is the passkey label).
  // mode === 'login'    → present an existing passkey (returning user).
  async function continueWithEmail(intent: CircleMode) {
    if (!emailStep) { setMode(intent); setEmailStep(true); return; }
    setErr('');
    setBusy(true);
    try {
      setCircleMode(intent);
      setCircleUsername(email.trim());
      await connectAsync({ connector: circle! });
      onClose();
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Passkey sign-in failed.');
      setBusy(false);
    } finally {
      setCircleMode(undefined); // don't leak intent into wagmi auto-reconnect
    }
  }

  function connectWallet() {
    onClose();
    openConnectModal?.();
  }

  return (
    <Modal title="Sign in to Echo" onClose={onClose}>
      <p className="mt-1 text-sm text-white/50">Echo identifies you by a wallet. Pick a path, we provision the rest.</p>

      <div className="mt-5 space-y-3">
        {showCircle && (
          emailStep ? (
            <div className="rounded-xl border border-white/10 p-3">
              <label className="block">
                <span className="text-xs font-medium text-white/50">Email</span>
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') continueWithEmail(mode); }}
                  placeholder="you@example.com"
                  className={INPUT_CLASS}
                />
              </label>
              {busy ? (
                <button disabled className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-ink opacity-50">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'register' ? 'Creating your passkey...' : 'Opening your passkey...'}
                </button>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => continueWithEmail('register')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition"
                  >
                    <Mail className="w-4 h-4" /> Create wallet
                  </button>
                  <button
                    onClick={() => continueWithEmail('login')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-medium text-white hover:border-white/30 transition"
                  >
                    Sign in
                  </button>
                </div>
              )}
              <p className="mt-1.5 text-xs text-white/40">
                New here? <b>Create wallet</b> makes a passkey (Face/Touch/PIN). Returning? <b>Sign in</b> with your existing passkey.
              </p>
            </div>
          ) : (
            <button
              onClick={() => continueWithEmail('register')}
              className="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-teal-500 bg-teal-500 px-4 py-3 text-sm font-semibold text-ink hover:bg-teal-400 transition"
            >
              <span className="inline-flex items-center gap-2"><Mail className="w-4 h-4" /> Continue with email</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )
        )}

        {showCircle && (
          <div className="flex items-center gap-3 text-xs text-white/30">
            <span className="h-px flex-1 bg-white/10" /> OR <span className="h-px flex-1 bg-white/10" />
          </div>
        )}

        <button
          onClick={connectWallet}
          className="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white hover:border-white/30 transition"
        >
          <span className="inline-flex items-center gap-2"><Wallet className="w-4 h-4" /> Connect a wallet</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {err && <p className="mt-3 text-xs text-danger break-all">{err}</p>}
    </Modal>
  );
}
