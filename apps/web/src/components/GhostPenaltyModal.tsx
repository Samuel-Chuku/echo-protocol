'use client';

import { AlertTriangle, Ban } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './ui';
import { short } from '@/lib/format';

/**
 * Shown after a successful "Trigger ghost" on a Final-tier applicant. The on-chain outcome has two
 * branches (EchoHook.triggerGhost):
 *   - paid:  the worker submitted but the requester never accepted → the FULL ghost reserve is paid
 *            to that one worker (job.provider). It is never split among other finalists.
 *   - !paid: the worker never delivered → they're slashed -1 rep and NO USDC moves (WorkerGhosted).
 */
export function GhostPenaltyModal({
  recipient,
  amount,
  paid,
  onClose,
}: {
  recipient: string;
  amount: string;
  paid: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={paid ? 'Ghost penalty paid' : 'Worker ghosted'} onClose={onClose}>
      {paid ? (
        <>
          <div className="mt-2 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-white/70">
              The requester missed the ghost deadline after this worker submitted. The full ghost
              reserve of <b className="text-white">${amount} USDC</b> was paid to the ghosted worker,
              and the requester&apos;s reputation was slashed.
            </p>
          </div>
          <div className="mt-3 flex justify-between text-sm rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <span className="font-mono text-white">{short(recipient)}</span>
            <span className="font-mono text-success">+${amount} USDC</span>
          </div>
        </>
      ) : (
        <div className="mt-2 flex items-start gap-3">
          <Ban className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-white/70">
            This worker <span className="font-mono text-white">{short(recipient)}</span> passed the
            ghost deadline without submitting, so they were slashed <b className="text-white">-1 reputation</b>.
            No USDC moved — the escrow is untouched and refunds to you on Close.
          </p>
        </div>
      )}
      <Button onClick={onClose} className="mt-5">Dismiss</Button>
    </Modal>
  );
}
