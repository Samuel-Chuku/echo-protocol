'use client';

import Link from 'next/link';
import { Briefcase, Search, Activity } from 'lucide-react';

/**
 * Role router. The old landing dumped a raw event ticker on everyone; this asks the one question that
 * matters first — what are you here to do — and routes to that flow (#1, #6). The live feed moved to
 * its own /activity tab (indexer-backed).
 */
const ROLES = [
  { href: '/hire', icon: Briefcase, title: 'Post a job', desc: 'Create an open market, direct job, or bounty and fund it in USDC.' },
  { href: '/apply', icon: Search, title: 'Find work', desc: 'Browse open markets, apply with your agent identity, and deliver.' },
  { href: '/activity', icon: Activity, title: 'Activity', desc: 'Track what is pending and completed across your markets and jobs.' },
];

export default function Landing() {
  return (
    <div>
      <section className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Echo Protocol</h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          The LP layer for human markets on Arc. Post work, find work, and settle it on-chain in USDC.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {ROLES.map(({ href, icon: Icon, title, desc }) => (
          <Link
            key={href}
            href={href}
            className="group p-6 rounded-2xl border border-gray-200 bg-white hover:border-gray-900 hover:shadow-sm transition"
          >
            <Icon className="w-6 h-6 text-gray-400 group-hover:text-gray-900 transition" />
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-gray-500">{desc}</p>
            <span className="mt-4 inline-block text-sm font-medium text-gray-900">Continue →</span>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-xs text-gray-400">
        Introducer attribution and dispute resolution live in their own tabs above.
      </p>
    </div>
  );
}
