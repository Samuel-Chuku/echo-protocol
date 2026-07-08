'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Search, Activity, ArrowRight, Wallet, ExternalLink } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { SignInModal } from '@/components/SignInModal';
import { StatCard, CARD_CLASS } from '@/components/ui';

// The marketing site (hero, problem, how-it-works, market types) now lives at echoprotocol.site.
// This page is the APP entry: quick stats, the three role paths, and sign-in.
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://echoprotocol.site';

const ROLES = [
  { href: '/hire', icon: Briefcase, title: 'Post a job', desc: 'Create an open market, direct job, or bounty and fund it in USDC.' },
  { href: '/apply', icon: Search, title: 'Find work', desc: 'Browse open markets, apply with your agent identity, and deliver.' },
  { href: '/activity', icon: Activity, title: 'Activity', desc: 'Track what is pending and completed across your markets and jobs.' },
];

export default function AppHome() {
  const { sdk, account } = useEcho();
  const [signInOpen, setSignInOpen] = useState(false);
  const [feeBps, setFeeBps] = useState<bigint>();

  useEffect(() => {
    sdk.protocolFeeBps().then((b) => setFeeBps(b as bigint)).catch(() => {});
  }, [sdk]);

  return (
    <div>
      {account ? (
        <section className="hero-waves rounded-3xl py-14 sm:py-20 px-2">
          <h1 className="text-4xl sm:text-[54px] font-extrabold tracking-tight text-white">Echo Protocol</h1>
          <p className="mt-3 text-lg text-white/60 max-w-2xl">
            The LP layer for human markets on Arc. Post work, find work, and settle it on-chain in USDC.
          </p>
          <div className="mt-6">
            <Link
              href="/apply"
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-ink hover:bg-teal-400 transition"
            >
              Browse markets <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Stake" value="Variable" sub="set by requester (0 = none)" />
            <StatCard label="Platform fee" value={feeBps !== undefined ? `${Number(feeBps) / 100}%` : '—'} sub="on payouts" />
            <StatCard label="Gas" value="$0.006" sub="per action" />
            <StatCard label="Reputation max" value="1000" sub="score ceiling" />
          </div>
        </section>
      ) : (
        <section id="hero" className="hero-waves rounded-3xl py-16 sm:py-24 px-2 text-center flex flex-col items-center">
          <h1 className="text-4xl sm:text-[54px] font-extrabold tracking-tight text-white max-w-2xl">
            Get paid for showing up. Build reputation that travels.
          </h1>
          <p className="mt-3 text-lg text-white/60 max-w-xl">
            Echo Protocol is the LP layer for human markets on Arc. Stake, deliver, and settle in USDC.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => setSignInOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-ink hover:bg-teal-400 transition"
            >
              <Wallet className="w-4 h-4" /> Connect wallet
            </button>
            <a
              href={MARKETING_URL}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-white hover:border-white/40 transition"
            >
              About Echo <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </section>
      )}

      {/* Role cards — the three paths into the app */}
      <section className="border-t border-white/[0.08] pt-10 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-4">Pick a path</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {ROLES.map(({ href, icon: Icon, title, desc }) => (
            <Link key={href} href={href} className={`group ${CARD_CLASS} p-[18px] sm:p-7`}>
              <Icon className="w-6 h-6 text-white/40 group-hover:text-teal-400 transition" />
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-1 text-sm text-white/50">{desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-teal-400">Continue →</span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-sm text-white/30">Introducer attribution and dispute resolution live in their own tabs above.</p>
      </section>

      {/* Slim footer with a link back to the marketing site */}
      <footer className="border-t border-white/[0.08] pt-8 mt-14 pb-10 flex flex-col gap-3 text-sm text-white/30 sm:flex-row sm:items-center sm:justify-between">
        <a href={MARKETING_URL} className="inline-flex items-center gap-1.5 text-white/50 hover:text-white transition">
          <ArrowRight className="w-3.5 h-3.5 rotate-180" /> echoprotocol.site
        </a>
        <span>Built on Arc Network · Powered by USDC</span>
        <span>© 2026 Echo Protocol</span>
      </footer>

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}
