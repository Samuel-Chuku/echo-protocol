'use client';

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
    <nav className="border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 h-14">
        <Link href="/" className="font-bold tracking-tight mr-4">Echo<span className="text-gray-400"> console</span></Link>
        {LINKS.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 text-sm rounded-md transition ${active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {l.label}
            </Link>
          );
        })}

        {/* Reputation lives in profiles for now; scoring is deferred. Show it as coming soon. */}
        <span
          title="Coming soon — reputation currently shows on profiles"
          className="px-3 py-1.5 text-sm rounded-md text-gray-400 cursor-default inline-flex items-center gap-1.5"
        >
          Reputation
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Soon</span>
        </span>

        {/* USDC balance + bell + wallet + profile avatar, pinned right (#4). */}
        <WalletStatus />
      </div>
    </nav>
  );
}
