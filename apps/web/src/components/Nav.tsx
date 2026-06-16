'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Bell } from './Bell';
import { SignInModal } from './SignInModal';

// Role-first IA. Create lives in the Requester flow (#6); Activity is a tab, not the landing (#10).
const LINKS = [
  { href: '/hire', label: 'Post a job' },
  { href: '/apply', label: 'Find work' },
  { href: '/attribution', label: 'Introducer' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/activity', label: 'Activity' },
];

export function Nav() {
  const path = usePathname();
  const [signInOpen, setSignInOpen] = useState(false);
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

        {/* wallet + notifications, pinned right (#4). Disconnected → our custom sign-in modal
            (email/passkey + connect-a-wallet); connected → RainbowKit's account chip. */}
        <div className="ml-auto flex items-center gap-2">
          <Bell />
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, mounted }) => {
              if (!mounted) return null;
              if (!account) {
                return (
                  <button onClick={() => setSignInOpen(true)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
                    Sign in
                  </button>
                );
              }
              if (chain?.unsupported) {
                return (
                  <button onClick={openChainModal} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500">
                    Wrong network
                  </button>
                );
              }
              return (
                <button onClick={openAccountModal} className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200">
                  {account.displayName}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </nav>
  );
}
