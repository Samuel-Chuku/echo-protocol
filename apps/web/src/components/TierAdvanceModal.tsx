'use client';

import { TxModal } from './TxModal';
import { short } from '@/lib/format';

/** Confirmation modal for advancing one applicant to the next payout tier. */
export function TierAdvanceModal({
  participant,
  fromLabel,
  toLabel,
  amount,
  run,
  onClose,
  onDone,
}: {
  participant: string;
  fromLabel: string;
  toLabel: string;
  amount: string;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone?: (result: unknown) => void;
}) {
  return (
    <TxModal
      title={`Advance to ${toLabel}`}
      description={
        <div className="space-y-1.5">
          <div className="flex justify-between"><span className="text-white/40">Applicant</span><span className="font-mono text-white">{short(participant)}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Current tier</span><span className="text-white">{fromLabel}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Next tier</span><span className="text-white">{toLabel}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Payout triggered</span><span className="font-mono text-teal-400">${amount} USDC</span></div>
        </div>
      }
      confirmLabel={`Advance to ${toLabel}`}
      run={run}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
