import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { ArcMark, Socials } from './ui';

// This footer renders on the marketing surface (/site). Its links point at the app, which in
// production is the app.* subdomain; falls back to the local app dev server in development.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const PROTOCOL_LINKS = [
  { label: 'Find work', href: `${APP_URL}/apply` },
  { label: 'Post a job', href: `${APP_URL}/hire` },
  { label: 'Introducer', href: `${APP_URL}/attribution` },
  { label: 'Activity', href: `${APP_URL}/activity` },
];

const DEVELOPER_LINKS = [
  { label: 'Arc Network', href: 'https://www.arc.network' },
  { label: 'ERC-8004', href: 'https://eips.ethereum.org' },
  { label: 'CCTP v2', href: 'https://www.circle.com/en/cross-chain-transfer-protocol' },
  { label: 'USDC', href: 'https://www.circle.com/en/usdc' },
];

export function Footer() {
  return (
    <footer className="border-t border-white/[0.08] mt-20">
      {/* CTA band */}
      <div className="hero-waves rounded-3xl mt-10 px-6 py-12 sm:px-10 sm:py-14 text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Ready to get paid for showing up?
        </h2>
        <p className="mt-2 text-white/60 max-w-md mx-auto">
          Post work, find work, and settle it on-chain in USDC. No one leaves empty-handed.
        </p>
        <a
          href={APP_URL}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-500 px-6 py-3 text-sm font-semibold text-ink hover:bg-teal-400 transition"
        >
          Go to App <ArrowRight className="w-4 h-4" />
        </a>
      </div>

      {/* Link columns */}
      <div className="pt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Image src="/logo-white.png" alt="Echo Protocol" width={255} height={60} className="h-9 w-auto" />
          <p className="mt-4 text-sm text-white/50 max-w-xs">
            The LP layer for human markets. Get paid for showing up. Build reputation that travels. Built on Arc.
          </p>
          <Socials className="mt-5" />
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Protocol</h4>
          <ul className="mt-4 space-y-2.5">
            {PROTOCOL_LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="text-sm text-white/60 hover:text-white transition">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Built on</h4>
          <ul className="mt-4 space-y-2.5">
            {DEVELOPER_LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href} target="_blank" rel="noreferrer" className="text-sm text-white/60 hover:text-white transition">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/40">Get started</h4>
          <ul className="mt-4 space-y-2.5">
            <li>
              <a href={`${APP_URL}/apply`} className="text-sm text-white/60 hover:text-white transition">Browse markets</a>
            </li>
            <li>
              <a href={`${APP_URL}/hire`} className="text-sm text-white/60 hover:text-white transition">Post a job</a>
            </li>
            <li>
              <a href="mailto:team@echoprotocol.site" className="text-sm text-white/60 hover:text-white transition">
                team@echoprotocol.site
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* Oversized logo watermark */}
      <div className="mt-14 flex justify-center overflow-hidden" aria-hidden>
        <Image
          src="/logo-white.png"
          alt=""
          width={1271}
          height={676}
          className="w-[85%] max-w-3xl select-none opacity-[0.045]"
        />
      </div>

      {/* Bottom bar */}
      <div className="flex flex-col gap-3 border-t border-white/[0.08] py-6 text-sm text-white/30 sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 Echo Protocol</span>
        <span className="flex items-center gap-1.5">
          Built on <ArcMark className="h-3.5 w-3.5 text-white/45" /> Arc Network · Powered by USDC
        </span>
        <span className="flex items-center gap-4">
          <span className="hover:text-white/60 transition cursor-default">Privacy</span>
          <span className="hover:text-white/60 transition cursor-default">Terms</span>
        </span>
      </div>
    </footer>
  );
}
