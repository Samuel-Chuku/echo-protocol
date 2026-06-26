'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletStatus } from './WalletStatus';

// Role-first IA. Disputes is intentionally NOT here — it's market-specific, reached from inside a job.
const LINKS = [
  { href: '/hire', label: 'Post a job' },
  { href: '/apply', label: 'Find work' },
  { href: '/attribution', label: 'Introducer' },
  { href: '/activity', label: 'Activity' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="border-b border-white/[0.08] bg-ink/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 h-16">
        <Link href="/" className="mr-4 flex items-center shrink-0">
          <Image src="/logo-color.png" alt="Echo Protocol" width={120} height={28} priority className="h-7 w-auto" />
        </Link>
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

        {/* Reputation lives in profiles for now; scoring is deferred. Show it as coming soon. */}
        <span
          title="Coming soon — reputation currently shows on profiles"
          className="px-3 py-1.5 text-sm rounded-full text-white/30 cursor-default inline-flex items-center gap-1.5"
        >
          Reputation
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">Soon</span>
        </span>

        {/* USDC balance + bell + wallet + profile avatar, pinned right (#4). */}
        <WalletStatus />
      </div>
    </nav>
  );
}
