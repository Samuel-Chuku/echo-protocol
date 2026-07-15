'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Check, X } from 'lucide-react';
import { isTxHash, txLink } from '@/lib/format';
import { formatTxError } from '@/lib/errors';
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
 * returns the tx hash; the button shows pending/result inline with an Arcscan link. Errors surface
 * the revert reason. Keep `run` a thunk so inputs are read at click time.
 */
export function Command({
  label,
  run,
  tone = 'primary',
  disabled,
  onDone,
  successText,
}: {
  label: string;
  run: () => Promise<unknown>;
  tone?: Tone;
  disabled?: boolean;
  /** Called after a successful run, use it to refresh adjacent read panels. */
  onDone?: (result: unknown) => void;
  /** Optional custom success message (e.g. "AR proposed successfully, AR #3") in place of the raw tx hash. */
  successText?: (result: unknown) => Promise<string> | string;
}) {
  const { run: runTx } = useTx();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; raw: unknown; msg: string } | null>(null);

  // Reads/utility buttons (Refresh, Load …) use tone="neutral" and shouldn't pop the tx overlay.
  const isWrite = tone !== 'neutral';

  async function onClick() {
    setBusy(true);
    setResult(null);
    try {
      const r = await run();
      const msg = successText ? await successText(r) : isTxHash(r) ? (r as string) : 'done';
      setResult({ ok: true, raw: r, msg });
      bumpBalances(); // refresh all mounted USDC balances the moment the action lands
      onDone?.(r);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; details?: string; message?: string };
      setResult({ ok: false, raw: null, msg: err.shortMessage || err.details || err.message || String(e) });
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
