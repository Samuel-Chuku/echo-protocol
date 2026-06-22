'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Check, X } from 'lucide-react';
import { isTxHash, txLink } from '@/lib/format';
import { formatTxError } from '@/lib/errors';
import { useTx } from '@/lib/tx';

type Tone = 'primary' | 'neutral' | 'danger';
const TONES: Record<Tone, string> = {
  primary: 'bg-gray-900 text-white hover:bg-gray-700',
  neutral: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

/**
 * The wired-button primitive every command uses. `run` performs the SDK call and (for writes)
 * returns the tx hash; the button shows pending/result inline with an Arcscan link. Errors surface
 * the revert reason. Keep `run` a thunk so inputs are read at click time.
 */
export function Command({
  label,
  run,
  tone = 'primary',
  disabled,
  onDone,
}: {
  label: string;
  run: () => Promise<unknown>;
  tone?: Tone;
  disabled?: boolean;
  /** Called after a successful run — use it to refresh adjacent read panels. */
  onDone?: (result: unknown) => void;
}) {
  const { run: runTx } = useTx();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reads/utility buttons (Refresh, Load …) use tone="neutral" and shouldn't pop the tx overlay.
  const isWrite = tone !== 'neutral';

  async function onClick() {
    setBusy(true);
    setResult(null);
    try {
      const r = isWrite ? await runTx({ title: label, kind: 'action' }, run) : await run();
      const msg = isTxHash(r) ? (r as string) : 'done';
      setResult({ ok: true, msg });
      onDone?.(r);
    } catch (e: unknown) {
      setResult({ ok: false, msg: formatTxError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={busy || disabled}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed ${TONES[tone]}`}
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
      </button>
      {result?.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-emerald-800 font-medium">{isWrite ? 'Transaction confirmed' : 'Done'}</p>
            {isTxHash(result.msg) ? (
              <a href={txLink(result.msg)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-700 underline mt-0.5 break-all">
                Tx: <span className="font-mono">{result.msg.slice(0, 10)}…{result.msg.slice(-8)}</span> <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <p className="text-xs text-emerald-700 mt-0.5">Action complete.</p>
            )}
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm flex items-start gap-2">
          <X className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-red-800 font-medium">Transaction failed</p>
            <p className="text-xs text-red-700 mt-0.5 break-all">{result.msg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
