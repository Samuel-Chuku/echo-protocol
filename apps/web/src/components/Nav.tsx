'use client';

import Image from 'next/image';
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
    <nav className="border-b border-white/[0.08] bg-ink/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 h-16">
        <Link href="/" className="mr-4 flex items-center shrink-0">
          <Image src="/logo-white.png" alt="Echo Protocol" width={160} height={40} priority className="h-[42px] w-auto" />
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

        {/* Reputation lives on profiles; show as coming soon. */}
        {repHref ? (
          <Link
            href={repHref}
            className={`px-3 py-1.5 text-sm rounded-full transition ${repActive ? 'bg-teal-500 text-ink' : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}
          >
            Reputation
          </Link>
        ) : (
          <span
            title="Connect a wallet to see your reputation"
            className="px-3 py-1.5 text-sm rounded-full text-white/30 cursor-default inline-flex items-center gap-1.5"
          >
            Reputation
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">Soon</span>
          </span>
        )}

        {/* USDC balance + bell + wallet + profile avatar, pinned right. */}
        <WalletStatus />
      </div>
    </nav>
  );
}
