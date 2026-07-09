'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { WalletStatus } from './WalletStatus';
import { ChainBadge } from './ChainBadge';

// Role-first IA. Disputes is intentionally NOT here: it's market-specific, reached from inside a job.
const LINKS = [
  { href: '/hire', label: 'Post a job' },
  { href: '/apply', label: 'Find work' },
  { href: '/attribution', label: 'Introducer' },
  { href: '/activity', label: 'Activity' },
];

function ReputationPill({ className = '' }: { className?: string }) {
  return (
    <span
      title="Coming soon. Reputation currently shows on profiles for now."
      className={`px-3 py-1.5 text-sm rounded-full text-white/30 cursor-default inline-flex items-center gap-1.5 ${className}`}
    >
      Reputation
      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">Soon</span>
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="border-b border-white/[0.08] bg-ink/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 flex items-center h-16">
        <Link href="/" className="flex items-center shrink-0">
          <Image src="/logo-white-tight.png" alt="Echo Protocol" width={907} height={279} priority className="h-8 sm:h-10 w-auto" />
        </Link>

        <div className="hidden md:flex mx-auto items-center gap-1">
          {LINKS.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 text-sm font-medium rounded-full transition ${
                  active ? 'bg-teal-500 text-ink' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <ReputationPill />
        </div>

        <div className="hidden md:flex ml-auto items-center gap-3">
          <ChainBadge />
          <WalletStatus />
        </div>

        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="md:hidden ml-auto flex h-11 w-11 items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/[0.06] transition"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      <div
        className={`md:hidden fixed inset-x-0 top-16 z-40 overflow-y-auto transition-all duration-300 ease-out ${
          open ? 'max-h-[calc(100vh-4rem)] opacity-100' : 'max-h-0 opacity-0'
        }`}
        style={{ backgroundColor: '#0d2d4a' }}
      >
        <div className="flex items-center justify-end px-5 py-2 border-b border-white/[0.08]">
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/[0.06] transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-col gap-1 px-5 py-4">
          {LINKS.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`min-h-[44px] flex items-center px-4 rounded-full text-base font-medium transition ${
                  active ? 'bg-teal-500 text-ink' : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <ReputationPill className="min-h-[44px]" />
        </div>

        <div className="border-t border-white/[0.08] px-5 py-4 space-y-3">
          <ChainBadge />
          {open && <WalletStatus />}
        </div>
      </div>
    </nav>
  );
}
