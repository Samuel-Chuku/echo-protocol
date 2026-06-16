'use client';

import Link from 'next/link';
import { Briefcase, Search, Activity, ArrowRight } from 'lucide-react';

/**
 * Landing: a hero with a single primary CTA (Browse Jobs), then the role cards in their own section
 * below — so the first screen asks one thing, not five (#1).
 */
const ROLES = [
  { href: '/hire', icon: Briefcase, title: 'Post a job', desc: 'Create an open market, direct job, or bounty and fund it in USDC.' },
  { href: '/apply', icon: Search, title: 'Find work', desc: 'Browse open markets, apply with your agent identity, and deliver.' },
  { href: '/activity', icon: Activity, title: 'Activity', desc: 'Track what is pending and completed across your markets and jobs.' },
];

export default function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="py-12 sm:py-16">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Echo Protocol</h1>
        <p className="mt-3 text-lg text-gray-500 max-w-2xl">
          The LP layer for human markets on Arc. Post work, find work, and settle it on-chain in USDC.
        </p>
        <div className="mt-6">
          <Link
            href="/apply"
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-700 transition"
          >
            Browse Jobs <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Role cards — below the hero, in their own section */}
      <section className="border-t border-gray-100 pt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-4">Or pick a path</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {ROLES.map(({ href, icon: Icon, title, desc }) => (
            <Link
              key={href}
              href={href}
              className="group p-6 rounded-2xl border border-gray-200 bg-white hover:border-gray-900 hover:shadow-sm transition"
            >
              <Icon className="w-6 h-6 text-gray-400 group-hover:text-gray-900 transition" />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-gray-500">{desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-gray-900">Continue →</span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-xs text-gray-400">Introducer attribution and dispute resolution live in their own tabs above.</p>
      </section>
    </div>
  );
}
