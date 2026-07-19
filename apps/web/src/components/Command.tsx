'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Check, X } from 'lucide-react';
import { isTxHash, txLink } from '@/lib/format';
import { humanizeError } from '@/lib/errors';
import { useTx } from '@/lib/tx';
import { bumpBalances } from '@/lib/balances';

type Tone = 'primary' | 'neutral' | 'danger';
const TONES: Record<Tone, string> = {
  primary: 'bg-teal-500 text-ink font-semibold hover:bg-teal-400',
  neutral: 'bg-transparent border border-white/20 text-white hover:border-white/40',
  danger: 'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20',
};

/**
 * The wired-button primitive every command uses. `run` performs the SDK call and (for writes)
 * returns the tx hash. Writes (tone !== 'neutral') route through the global tx overlay so EVERY
 * value-moving action gets the signing → success-receipt modal (user ask 2026-07-19); reads and
 * utility buttons (Refresh, Load…) stay inline-only. The inline result line remains for both as a
 * persistent record after the modal closes. Keep `run` a thunk so inputs are read at click time.
 */
export function Command({
  label,
  run,
  tone = 'primary',
  disabled,
  onDone,
  successText,
  modal,
}: {
  label: string;
  run: () => Promise<unknown>;
  tone?: Tone;
  disabled?: boolean;
  /** Called after a successful run, use it to refresh adjacent read panels. */
  onDone?: (result: unknown) => void;
  /** Optional custom success message (e.g. "AR proposed successfully, AR #3") in place of the raw tx hash. */
  successText?: (result: unknown) => Promise<string> | string;
  /** Overlay override. Tone is styling, not semantics — some WRITES are styled neutral (Settle
   *  stake, Reject, Vote against…): pass modal to force the overlay on them; modal={false} keeps a
   *  non-neutral utility button overlay-free. Default: overlay iff tone !== 'neutral'. */
  modal?: boolean;
}) {
  const { run: runTx } = useTx();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; raw: unknown; msg: string } | null>(null);

  // Reads/utility buttons (Refresh, Load …) use tone="neutral" and shouldn't pop the tx overlay.
  const isWrite = modal ?? tone !== 'neutral';

  async function onClick() {
    setBusy(true);
    setResult(null);
    try {
      // Writes go through the overlay (it owns signing/success/error presentation + bumpBalances);
      // reads run bare. The overlay rethrows on failure so both paths land in the same catch.
      const r = isWrite ? await runTx({ title: label }, run) : await run();
      const msg = successText ? await successText(r) : isTxHash(r) ? (r as string) : 'done';
      setResult({ ok: true, raw: r, msg });
      if (!isWrite) bumpBalances(); // overlay already bumped for writes
      onDone?.(r);
    } catch (e: unknown) {
      // The overlay already showed the humanized error for writes; keep the inline line as a
      // persistent record either way.
      setResult({ ok: false, raw: null, msg: humanizeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={busy || disabled}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] ${TONES[tone]}`}
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
      </button>
      {result && result.ok && (
        <div className="text-xs flex items-start gap-1 text-success">
          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {isTxHash(result.msg) ? (
            <a href={txLink(result.msg)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline break-all">
              {result.msg.slice(0, 10)}…{result.msg.slice(-8)} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="break-all">
              {result.msg}
              {isTxHash(result.raw) && (
                <a href={txLink(result.raw as string)} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-1 underline">
                  view tx <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </span>
          )}
        </div>
      )}
      {result && !result.ok && (
        <div className="text-xs flex items-start gap-1 text-danger">
          <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{result.msg}</span>
          <button onClick={onClick} className="underline shrink-0 hover:text-danger/80">Retry</button>
        </div>
      )}
    </div>
  );
}
