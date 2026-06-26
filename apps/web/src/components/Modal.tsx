'use client';

import { type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Shared dark-overlay/centered-card shell every modal in the app builds on. */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} rounded-modal border border-white/10 bg-[#0d2d4a] p-6 shadow-2xl`}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
