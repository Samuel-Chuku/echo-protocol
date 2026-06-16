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
    <div className="space-y-1">
      <button
        onClick={onClick}
        disabled={busy || disabled}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed ${TONES[tone]}`}
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
      </button>
      {result && (
        <div className={`text-xs flex items-start gap-1 ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
          {result.ok ? <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          {isTxHash(result.msg) ? (
            <a href={txLink(result.msg)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline break-all">
              {result.msg.slice(0, 10)}…{result.msg.slice(-8)} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="break-all">{result.msg}</span>
          )}
        </div>
      )}
    </div>
  );
}
