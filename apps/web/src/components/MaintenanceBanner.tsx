'use client';

import { AlertTriangle } from 'lucide-react';
import { useFlag } from '@/lib/flags';

/** Site-wide banner shown when the operator flips `web.maintenance` in the ops dashboard. */
export function MaintenanceBanner() {
  const on = useFlag('web.maintenance');
  if (!on) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">
      <AlertTriangle className="h-4 w-4" />
      Echo is undergoing maintenance — some actions may be temporarily unavailable.
    </div>
  );
}
