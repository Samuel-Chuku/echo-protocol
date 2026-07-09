import Image from 'next/image';
import { ArrowRight, Layers, Briefcase, Award } from 'lucide-react';
import { StatCard, CARD_CLASS, TierTrack, type TierStep } from '@/components/ui';
import { EchoFlowGraphic } from '@/components/EchoFlowGraphic';
import { Footer } from '@/components/Footer';

// Marketing surface, served at the bare domain (echoprotocol.site) via middleware host-rewrite.
// "Go to App" links cross to the app.* subdomain in production, or the local app dev server in dev.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Honest, protocol-/Arc-level facts only — no per-market figures asserted as constants.
const STATS = [
  { label: 'Stake', value: 'Variable', sub: 'set by requester' },
  { label: 'Settle in', value: 'USDC', sub: 'native on Arc' },
  { label: 'Gas', value: '~$0.006', sub: 'per action' },
  { label: 'Finality', value: 'Sub-second', sub: 'on Arc' },
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
  { title: 'Stake to submit', desc: 'A requester-set stake (sometimes none) filters spam and signals you are serious before anyone reviews your work.' },
  { title: 'Advance through tiers', desc: 'Each advance triggers an automatic USDC payout straight to your wallet.' },
  { title: 'Earn at every stage', desc: 'Each round pays out in USDC, and the ghost penalty protects you if a hirer disappears.' },
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
      { label: 'Stake', amount: 'stake' },
      { label: 'Shortlist', amount: '+USDC' },
      { label: 'Final', amount: '+USDC' },
      { label: 'Ghost', amount: 'split' },
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
      { label: 'Stake', amount: 'stake' },
      { label: 'Valid', amount: '+USDC' },
      { label: 'Merged', amount: '+USDC' },
      { label: 'Ghost', amount: '14d' },
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

export default function Landing() {
  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6">
      {/* Header */}
      <header className="sticky top-0 z-30 -mx-5 sm:-mx-6 px-5 sm:px-6 py-4 bg-ink/80 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center">
            <Image src="/logo-white-tight.png" alt="Echo Protocol" width={907} height={279} priority className="h-9 sm:h-10 w-auto" />
          </a>
          <nav className="flex items-center gap-5">
            <a href="#how-it-works" className="hidden sm:inline text-sm text-white/50 hover:text-white transition">How it works</a>
            <a href="#markets" className="hidden sm:inline text-sm text-white/50 hover:text-white transition">Market types</a>
            <a
              href={APP_URL}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-ink hover:bg-teal-400 transition"
            >
              Go to App <ArrowRight className="w-4 h-4" />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-waves rounded-3xl mt-6 py-16 sm:py-20 px-4 sm:px-8 text-center flex flex-col items-center">
        <h1 className="text-4xl sm:text-[54px] font-extrabold tracking-tight text-white max-w-3xl leading-[1.05]">
          Get paid for showing up. Build reputation that travels.
        </h1>
        <p className="mt-4 text-lg text-white/60 max-w-xl">
          Echo Protocol is the LP layer for human markets on Arc. Post work, find work, and settle it on-chain in USDC.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <a
            href={APP_URL}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-ink hover:bg-teal-400 transition"
          >
            Go to App <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-white hover:border-white/40 transition"
          >
            Learn how it works
          </a>
        </div>

        <div className="mt-12 w-full max-w-lg">
          <EchoFlowGraphic />
        </div>

        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
          {STATS.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
          ))}
        </div>
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
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS_STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500 text-ink text-sm font-bold">
                {i + 1}
              </span>
              <h3 className="mt-3 text-base font-semibold text-white">{s.title}</h3>
              <p className="mt-1 text-sm text-white/50">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Market types */}
      <section id="markets" className="border-t border-white/[0.08] pt-14 mt-14">
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
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-white/30 mb-2">Example ladder · amounts set per market</p>
                    <TierTrack steps={m.tiers} currentIndex={m.tiers.length - 1} />
                  </>
                ) : (
                  <p className="text-sm text-white/40 border-t border-white/[0.08] pt-3">{m.note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
