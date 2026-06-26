'use client';

import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './ui';
import { short } from '@/lib/format';

/** Shown after a successful "Trigger ghost" action — explains the penalty that was just paid out. */
export function GhostPenaltyModal({
  amount,
  finalists,
  onClose,
}: {
  amount: string;
  finalists: string[];
  onClose: () => void;
}) {
  const share = finalists.length > 0 ? (Number(amount) / finalists.length).toFixed(2) : amount;
  return (
    <Modal title="Ghost penalty triggered" onClose={onClose}>
      <div className="mt-2 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <p className="text-sm text-white/70">
          The requester missed the ghost deadline on a final-round applicant. The market&apos;s ghost
          penalty of <b className="text-white">${amount} USDC</b> has been paid out
          {finalists.length > 0 ? ', split among the finalists still in this round:' : '.'}
        </p>
      </div>
      {finalists.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {finalists.map((f) => (
            <li key={f} className="flex justify-between text-sm rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5">
              <span className="font-mono text-white">{short(f)}</span>
              <span className="font-mono text-success">${share} USDC</span>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onClose} className="mt-5">Dismiss</Button>
    </Modal>
  );
}
