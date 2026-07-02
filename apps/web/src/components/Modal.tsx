'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Shared dark-overlay/centered-card shell every modal in the app builds on.
 * Portaled to document.body: the nav's `backdrop-blur` establishes a CSS containing block for
 * `position: fixed` descendants, so a modal opened from inside the nav (e.g. WalletStatus) would
 * otherwise be clipped/centered to the 64px nav bar instead of the viewport.
 */
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`modal-sheet relative w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-modal border border-white/10 bg-[#0d2d4a] p-5 sm:p-6 shadow-2xl`}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center -m-2 rounded-full text-white/40 hover:text-white transition" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
