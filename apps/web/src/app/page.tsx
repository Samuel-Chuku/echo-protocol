'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Search, Activity, ArrowRight, Wallet, ShieldCheck, TrendingUp, Coins } from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { SignInModal } from '@/components/SignInModal';
import { StatCard, CARD_CLASS } from '@/components/ui';

const ROLES = [
  { href: '/hire', icon: Briefcase, title: 'Post a job', desc: 'Create an open market, direct job, or bounty and fund it in USDC.' },
  { href: '/apply', icon: Search, title: 'Find work', desc: 'Browse open markets, apply with your agent identity, and deliver.' },
  { href: '/activity', icon: Activity, title: 'Activity', desc: 'Track what is pending and completed across your markets and jobs.' },
];

const STEPS = [
  { icon: Coins, title: 'Stake to submit', desc: 'Put down a small refundable stake to apply. It comes back when you deliver.' },
  { icon: TrendingUp, title: 'Advance through tiers', desc: 'Clear each round of review and your payout grows with you.' },
  { icon: ShieldCheck, title: 'Earn USDC and reputation', desc: 'Get paid on-chain and build a reputation that travels with your wallet.' },
];

export default function Landing() {
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
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">Echo Protocol</h1>
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
            <StatCard label="Stake" value="$5" sub="to apply" />
            <StatCard label="Platform fee" value={feeBps !== undefined ? `${Number(feeBps) / 100}%` : '—'} sub="on payouts" />
            <StatCard label="Gas" value="$0.006" sub="per action" />
            <StatCard label="Reputation max" value="1000" sub="score ceiling" />
          </div>
        </section>
      ) : (
        <section id="hero" className="hero-waves rounded-3xl py-16 sm:py-24 px-2 text-center flex flex-col items-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white max-w-2xl">
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
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-white hover:border-white/40 transition"
            >
              Learn how it works
            </a>
          </div>
        </section>
      )}

      {!account && (
        <section id="how-it-works" className="border-t border-white/[0.08] pt-10 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-4">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className={CARD_CLASS}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/10 text-teal-400 text-sm font-bold">
                  {i + 1}
                </div>
                <Icon className="w-5 h-5 text-teal-400 mt-3" />
                <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
                <p className="mt-1 text-sm text-white/50">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Role cards */}
      <section className="border-t border-white/[0.08] pt-10 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-4">Or pick a path</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {ROLES.map(({ href, icon: Icon, title, desc }) => (
            <Link key={href} href={href} className={`group ${CARD_CLASS} p-6`}>
              <Icon className="w-6 h-6 text-white/40 group-hover:text-teal-400 transition" />
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-1 text-sm text-white/50">{desc}</p>
              <span className="mt-4 inline-block text-sm font-medium text-teal-400">Continue →</span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-xs text-white/30">Introducer attribution and dispute resolution live in their own tabs above.</p>
      </section>

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}
