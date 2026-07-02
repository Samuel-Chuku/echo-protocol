'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Briefcase,
  Search,
  Activity,
  ArrowRight,
  Wallet,
  Layers,
  Award,
  Github,
  Twitter,
  MessageCircle,
} from 'lucide-react';
import { useEcho } from '@/lib/sdk';
import { SignInModal } from '@/components/SignInModal';
import { StatCard, CARD_CLASS, TierTrack, type TierStep } from '@/components/ui';
import { EchoFlowGraphic } from '@/components/EchoFlowGraphic';

const ROLES = [
  { href: '/hire', icon: Briefcase, title: 'Post a job', desc: 'Create an open market, direct job, or bounty and fund it in USDC.' },
  { href: '/apply', icon: Search, title: 'Find work', desc: 'Browse open markets, apply with your agent identity, and deliver.' },
  { href: '/activity', icon: Activity, title: 'Activity', desc: 'Track what is pending and completed across your markets and jobs.' },
];

const PROBLEM_CARDS = [
  {
    value: '249',
    title: 'People get nothing',
    desc: '249 serious candidates apply to a single role and walk away with nothing for their time: no pay, no signal, no record they ever showed up.',
  },
  {
    value: '0',
    title: 'Portable reputation',
    desc: 'A flawless track record on one platform means nothing on the next. Reputation lives nowhere and travels with no one.',
  },
  {
    highlight: true,
    title: 'Echo turns lost labor into value',
    desc: 'Every stage of every market pays out in USDC, and every action mints reputation that travels with your wallet. No one leaves empty-handed.',
  },
  {
    value: '20%',
    title: 'What platforms take',
    desc: 'Upwork and Fiverr take up to 20% off the top and give you nothing portable in return: no reputation, no record, no equity in the relationship.',
  },
];

const HOW_IT_WORKS_STEPS = [
  { title: 'Stake to submit', desc: '$5 filters spam and signals you are serious before anyone reviews your work.' },
  { title: 'Advance through tiers', desc: 'Each advance triggers an automatic USDC payout straight to your wallet.' },
  { title: 'Earn at every stage', desc: 'The final round pays $250, and the ghost penalty protects you if a hirer disappears.' },
  { title: 'Build reputation', desc: 'Every market you complete builds a portable score and non-transferable badges.' },
];

const MARKET_TYPES = [
  {
    tag: 'Open / Reveal',
    icon: Layers,
    accent: 'teal' as const,
    title: 'Open / Reveal',
    desc: "Submit blind, get shortlisted, and reveal your identity only once you're in the running.",
    tiers: [
      { label: 'Stake', amount: '5' },
      { label: 'Shortlist', amount: '50' },
      { label: 'Final', amount: '250' },
      { label: 'Ghost', amount: '250 split' },
    ] satisfies TierStep[],
  },
  {
    tag: 'Direct Job',
    icon: Briefcase,
    accent: 'success' as const,
    title: 'Direct Job',
    desc: 'Negotiate custom milestones with a hirer and get paid in USDC as each one clears.',
    note: 'Payout amounts and milestone count are set per job. There is no fixed tier table.',
  },
  {
    tag: 'Bounty',
    icon: Award,
    accent: 'warning' as const,
    title: 'Bounty',
    desc: 'Submit a fix, get validated, get merged: open competition paid out in stages.',
    tiers: [
      { label: 'Stake', amount: '5' },
      { label: 'Valid', amount: '20' },
      { label: 'Merged', amount: '100' },
      { label: 'Ghost', amount: '150 after 14d' },
    ] satisfies TierStep[],
  },
];

const ACCENT_CARD: Record<'teal' | 'success' | 'warning', string> = {
  teal: 'border-teal-500/30 before:bg-teal-500',
  success: 'border-success/30 before:bg-success',
  warning: 'border-warning/30 before:bg-warning',
};

const ACCENT_TAG: Record<'teal' | 'success' | 'warning', string> = {
  teal: 'bg-teal-500/15 text-teal-400',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
};

const PROTOCOL_LINKS = [
  { href: '/apply', label: 'Find work' },
  { href: '/hire', label: 'Post a job' },
  { href: '/attribution', label: 'Introducer' },
  { href: '/activity', label: 'Activity' },
];

const DEVELOPER_LINKS = ['Documentation', 'GitHub', 'ERC-8183', 'ERC-8004', 'CCTP v2'];
const COMMUNITY_LINKS = ['Discord', 'Twitter', 'Arc Network', 'Circle Dev Tools'];

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
            <StatCard label="Stake" value="$5" sub="to apply" />
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
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-white hover:border-white/40 transition"
            >
              Learn how it works
            </a>
          </div>
        </section>
      )}

      {/* Echo flow graphic: replaces the dead space between the stats row and the role cards. */}
      <section className="pt-10 mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-4 text-center">The Echo flow</h2>
        <EchoFlowGraphic />
      </section>

      {/* Role cards */}
      <section className="border-t border-white/[0.08] pt-10 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-4">Or pick a path</h2>
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

      {/* The problem */}
      <section className="border-t border-white/[0.08] pt-14 mt-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-400 mb-2">The problem</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white max-w-2xl">
          Every human market runs on unpaid loser labor.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PROBLEM_CARDS.map((c) =>
            c.highlight ? (
              <div key={c.title} className="relative rounded-card border border-teal-500/30 bg-teal-500/[0.08] p-[18px] sm:p-7">
                <h3 className="text-lg font-semibold text-white">{c.title}</h3>
                <p className="mt-2 text-sm text-white/60">{c.desc}</p>
              </div>
            ) : (
              <div key={c.title} className={CARD_CLASS + ' p-[18px] sm:p-7'}>
                <p className="text-3xl font-extrabold text-white tabular-nums">{c.value}</p>
                <h3 className="mt-2 text-base font-semibold text-white">{c.title}</h3>
                <p className="mt-1 text-sm text-white/50">{c.desc}</p>
              </div>
            )
          )}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-white/[0.08] pt-14 mt-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-400 mb-2">How it works</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white max-w-2xl">
          Stake once. Earn as you advance.
        </h2>
        <ol className="mt-10 flex flex-col gap-8 sm:flex-row sm:gap-0">
          {HOW_IT_WORKS_STEPS.map((s, i) => (
            <li key={s.title} className="flex-1 relative sm:px-3">
              {i > 0 && (
                <span
                  className="hidden sm:block absolute top-5 right-1/2 left-[-50%] h-px bg-gradient-to-r from-teal-500/60 to-teal-500/10"
                  aria-hidden
                />
              )}
              <div className="flex gap-4 sm:block">
                {/* Mobile: numbered node + vertical connector in a left gutter. Desktop: node sits above the text, connected by the horizontal line above. */}
                <div className="relative flex flex-col items-center shrink-0 sm:hidden">
                  <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-teal-500 text-ink text-sm font-bold">
                    {i + 1}
                  </span>
                  {i < HOW_IT_WORKS_STEPS.length - 1 && (
                    <span className="absolute top-10 bottom-[-2rem] w-px bg-gradient-to-b from-teal-500/60 to-teal-500/10" aria-hidden />
                  )}
                </div>
                <span className="hidden sm:relative sm:z-10 sm:flex h-10 w-10 items-center justify-center rounded-full bg-teal-500 text-ink text-sm font-bold">
                  {i + 1}
                </span>
                <div>
                  <h3 className="sm:mt-3 text-base font-semibold text-white">{s.title}</h3>
                  <p className="mt-1 text-sm text-white/50">{s.desc}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Market types */}
      <section className="border-t border-white/[0.08] pt-14 mt-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-400 mb-2">Market types</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white max-w-2xl">
          One protocol. Three market shapes.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {MARKET_TYPES.map((m) => (
            <div key={m.title} className={`${CARD_CLASS} p-[18px] sm:p-7 ${ACCENT_CARD[m.accent]}`}>
              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${ACCENT_TAG[m.accent]}`}>
                <m.icon className="w-3.5 h-3.5" /> {m.tag}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">{m.title}</h3>
              <p className="mt-1 text-sm text-white/50">{m.desc}</p>
              <div className="mt-5">
                {m.tiers ? (
                  <TierTrack steps={m.tiers} currentIndex={m.tiers.length - 1} />
                ) : (
                  <p className="text-sm text-white/40 border-t border-white/[0.08] pt-3">{m.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] pt-14 mt-14 pb-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Image src="/logo-white-mark.png" alt="Echo Protocol" width={32} height={32} className="h-8 w-8" />
            <p className="mt-4 text-sm text-white/50 max-w-xs">
              Get paid for showing up. Build reputation that travels. Built on Arc Network.
            </p>
            <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              {[
                { icon: Twitter, label: 'Twitter' },
                { icon: MessageCircle, label: 'Discord' },
                { icon: Github, label: 'GitHub' },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  title={`${label} (coming soon)`}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white/40"
                >
                  <Icon className="w-4 h-4" />
                </span>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Protocol</h4>
            <ul className="mt-4 space-y-2.5">
              {PROTOCOL_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-white/60 hover:text-white transition">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <span className="text-sm text-white/30 cursor-default inline-flex items-center gap-1.5">
                  Reputation
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                    Soon
                  </span>
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Developer</h4>
            <ul className="mt-4 space-y-2.5">
              {DEVELOPER_LINKS.map((l) => (
                <li key={l}>
                  <span className="text-sm text-white/60">{l}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Community</h4>
            <ul className="mt-4 space-y-2.5">
              {COMMUNITY_LINKS.map((l) => (
                <li key={l}>
                  <span className="text-sm text-white/60">{l}</span>
                </li>
              ))}
              <li>
                <a href="mailto:team@echo.xyz" className="text-sm text-white/60 hover:text-white transition">
                  team@echo.xyz
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/[0.08] pt-6 text-sm text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Echo Protocol</span>
          <span>Built on Arc Network · Powered by USDC</span>
          <span className="flex items-center gap-4">
            <span>Privacy</span>
            <span>Terms</span>
            <span>Docs</span>
          </span>
        </div>
      </footer>

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  );
}
