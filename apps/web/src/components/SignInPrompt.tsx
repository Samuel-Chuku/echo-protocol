'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, XCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * Sign-In-With-Ethereum status toast. SIWE is auto-prompted right after a wallet connects (see
 * AuthProvider); this surface just tells the user what's happening in-app while their wallet asks
 * for the signature, and offers a retry if it fails. It is NOT a gate and NOT a nav button — it
 * appears only transiently:
 *   • prompting → "check your wallet" + the reassurance that it's gas-free
 *   • error     → what went wrong + Try again / Dismiss
 *   • signed-in → a brief "Signed in" confirmation, then it disappears
 * On a plain user-cancel (declined) it shows nothing — the wallet popup was the prompt.
 */
export function SignInPrompt() {
  const { status, error, signIn, dismiss } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);

  // Flash a short confirmation when a sign-in completes, then fade out.
  useEffect(() => {
    if (status !== 'signed-in') return;
    setShowSuccess(true);
    const t = setTimeout(() => setShowSuccess(false), 2500);
    return () => clearTimeout(t);
  }, [status]);

  const visible = status === 'prompting' || status === 'error' || (status === 'signed-in' && showSuccess);
  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d2d4a] shadow-2xl">
        {status === 'prompting' && (
          <div className="flex items-start gap-3 p-4">
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-teal-300" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Check your wallet</p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/60">
                Sign the message to prove you own this wallet. It&apos;s free — no transaction, no gas,
                no funds move.
              </p>
              <button
                onClick={dismiss}
                className="mt-2 text-xs font-medium text-white/50 hover:text-white transition"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-3 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Couldn&apos;t sign in</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-white/60">
                {error || 'Something went wrong proving wallet ownership.'}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => void signIn()}
                  className="inline-flex items-center gap-1 rounded-full bg-teal-500 px-3 py-1 text-xs font-semibold text-ink hover:bg-teal-400 transition"
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Try again
                </button>
                <button onClick={dismiss} className="text-xs font-medium text-white/50 hover:text-white transition">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {status === 'signed-in' && showSuccess && (
          <div className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-300" />
            <p className="text-sm font-medium text-white">Signed in — wallet ownership verified</p>
          </div>
        )}
      </div>
    </div>
  );
}
