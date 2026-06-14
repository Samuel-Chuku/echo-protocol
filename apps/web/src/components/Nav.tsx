'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Activity' },
  { href: '/hire', label: 'Requester' },
  { href: '/apply', label: 'Worker' },
  { href: '/attribution', label: 'Introducer' },
  { href: '/disputes', label: 'Disputes' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 h-12">
        <Link href="/" className="font-bold tracking-tight mr-4">Echo<span className="text-gray-400"> console</span></Link>
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
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
      </div>
    </nav>
  );
}
