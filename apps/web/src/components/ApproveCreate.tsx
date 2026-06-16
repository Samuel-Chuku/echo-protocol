'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Check, X } from 'lucide-react';
import { isTxHash, txLink } from '@/lib/format';
import { formatTxError } from '@/lib/errors';

/**
 * A two-step action button: one button position that the user clicks twice, producing two separate
 * wallet confirmations. Step 1 ("Approve") runs the USDC allowance; on success the same button flips
 * to step 2 ("Create"). Each step surfaces its own pending/result, and the decoded revert reason on
 * failure (see lib/errors). Keep `approve`/`create` as thunks so inputs read at click time.
 */
export function ApproveCreate({
  approveLabel,
  createLabel,
  approve,
  create,
  disabled,
  onDone,
}: {
  approveLabel: string;
  createLabel: string;
  approve: () => Promise<unknown>;
  create: () => Promise<unknown>;
  disabled?: boolean;
  /** Called after a successful create — use it to refresh adjacent read panels. */
  onDone?: (result: unknown) => void;
}) {
  const [step, setStep] = useState<'approve' | 'create'>('approve');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function onApprove() {
    setBusy(true);
    setResult(null);
    try {
      await approve();
      setStep('create');
      setResult({ ok: true, msg: 'Approved — now create (a second wallet confirmation).' });
    } catch (e) {
      setResult({ ok: false, msg: formatTxError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    setBusy(true);
    setResult(null);
    try {
      const r = await create();
      setResult({ ok: true, msg: isTxHash(r) ? (r as string) : 'done' });
      onDone?.(r);
    } catch (e) {
      setResult({ ok: false, msg: formatTxError(e) });
    } finally {
      setBusy(false);
    }
  }

  const isApprove = step === 'approve';
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          onClick={isApprove ? onApprove : onCreate}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed bg-gray-900 text-white hover:bg-gray-700"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isApprove ? approveLabel : createLabel}
        </button>
        {/* Step indicator: 1 Approve → 2 Create. */}
        <span className="text-xs text-gray-400">
          Step {isApprove ? '1 of 2 — approve' : '2 of 2 — create'}
        </span>
        {!isApprove && !busy && (
          <button
            type="button"
            onClick={() => { setStep('approve'); setResult(null); }}
            className="text-xs text-gray-400 underline hover:text-gray-700"
          >
            back to approve
          </button>
        )}
      </div>
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
