'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
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
  const { address } = useAccount();
  const repHref = address ? `/u/${address}` : null;
  const repActive = !!repHref && path.startsWith(repHref);
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

        {/* Reputation = the connected wallet's own profile (rep section anchors there). Disabled
            chip when no wallet connected, so the nav layout stays stable on connect. */}
        {repHref ? (
          <Link
            href={repHref}
            className={`px-3 py-1.5 text-sm rounded-md transition ${repActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Reputation
          </Link>
        ) : (
          <span
            title="Connect a wallet to see your reputation"
            className="px-3 py-1.5 text-sm rounded-md text-gray-400 cursor-default"
          >
            Reputation
          </span>
        )}

        {/* USDC balance + bell + wallet + profile avatar, pinned right (#4). */}
        <WalletStatus />
      </div>
    </nav>
  );
}
