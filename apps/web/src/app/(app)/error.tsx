'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center text-center py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <p className="mt-4 text-lg font-bold text-white">Something went wrong</p>
      <p className="mt-1 text-sm text-white/50 max-w-md break-all">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" href="/">Back to home</Button>
      </div>
    </div>
  );
}
