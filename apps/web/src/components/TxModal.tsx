'use client';

import { useState, type ReactNode } from 'react';
import { Loader2, CheckCircle2, ExternalLink, AlertCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './ui';
import { isTxHash, txLink } from '@/lib/format';
import { humanizeError } from '@/lib/errors';

type Step = 'confirm' | 'pending' | 'success' | 'error';

/**
 * Generic reusable modal for on-chain actions: confirm -> pending -> success, with an Arcscan link.
 * `run` does the actual SDK call (unchanged) — this only adds modal presentation around it.
 */
export function TxModal({
  title,
  description,
  confirmLabel = 'Confirm',
  gasEstimate = '$0.006',
  run,
  onClose,
  onDone,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  gasEstimate?: string | null;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone?: (result: unknown) => void;
}) {
  const [step, setStep] = useState<Step>('confirm');
  const [result, setResult] = useState<string>('');

  async function onConfirm() {
    setStep('pending');
    try {
      const r = await run();
      const msg = isTxHash(r) ? (r as string) : 'done';
      setResult(msg);
      setStep('success');
      onDone?.(r);
    } catch (e: unknown) {
      setResult(humanizeError(e));
      setStep('error');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {step === 'confirm' && (
        <>
          <div className="mt-3 text-sm text-white/60">{description}</div>
          {gasEstimate && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
              <span className="text-white/40">Estimated gas</span>
              <span className="font-mono text-white">{gasEstimate} USDC</span>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            <Button onClick={onConfirm}>{confirmLabel}</Button>
            <button onClick={onClose} className="text-sm text-white/50 hover:text-white transition">
              Cancel
            </button>
          </div>
        </>
      )}

      {step === 'pending' && (
        <div className="mt-6 flex flex-col items-center text-center py-4">
          <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
          <p className="mt-3 text-sm text-white/60">Waiting for confirmation…</p>
        </div>
      )}

      {step === 'success' && (
        <div className="mt-6 flex flex-col items-center text-center py-4">
          <CheckCircle2 className="w-10 h-10 text-success" />
          <p className="mt-3 text-sm font-medium text-white">Done</p>
          {isTxHash(result) && (
            <a
              href={txLink(result)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-teal-400 hover:underline"
            >
              View on Arcscan <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <Button onClick={onClose} className="mt-5">Close</Button>
        </div>
      )}

      {step === 'error' && (
        <div className="mt-6 flex flex-col items-center text-center py-4">
          <AlertCircle className="w-10 h-10 text-danger" />
          <p className="mt-3 text-sm text-white/70 break-all">{result}</p>
          <div className="mt-5 flex items-center gap-3">
            <Button onClick={onConfirm}>Try again</Button>
            <button onClick={onClose} className="text-sm text-white/50 hover:text-white transition">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
