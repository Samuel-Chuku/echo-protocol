'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Briefcase, Wrench, Share2, Compass, Bot, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getAgentWallet } from '@/lib/agentApi';

/**
 * One-time onboarding after a wallet connects: "what brings you to Echo?" — Hirer / Applicant /
 * Introducer / Just exploring (all of it). Routes them to the right surface, and offers hirers an
 * agent wallet up front (provisioned instantly via getAgentWallet; usage stays optional). The choice
 * is a soft preference stored per-address in localStorage — it gates nothing, so "exploring" users
 * lose no capability, and it never re-prompts for an address that has answered.
 */

type Role = 'hirer' | 'applicant' | 'introducer' | 'explorer';
const KEY = (addr: string) => `echo.onboarded.${addr.toLowerCase()}`;

const ROLES: { role: Role; title: string; desc: string; icon: typeof Briefcase; href: string }[] = [
  { role: 'hirer', title: 'I want to hire', desc: 'Post work, screen applicants, pay through escrowed markets.', icon: Briefcase, href: '/hire' },
  { role: 'applicant', title: 'I want to work', desc: 'Browse open markets, apply, climb the payout ladder.', icon: Wrench, href: '/apply' },
  { role: 'introducer', title: 'I introduce talent', desc: 'Connect workers to markets and earn attribution rewards.', icon: Share2, href: '/attribution' },
  { role: 'explorer', title: 'Just exploring', desc: 'Look around first — you can do any (or all) of these any time.', icon: Compass, href: '/' },
];

export function Onboarding() {
  const { address, isConnected } = useAccount();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Role | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [agentAddr, setAgentAddr] = useState<string | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null);

  // Show once per address, only after connect. (Answered/skipped ⇒ never again for that address.)
  useEffect(() => {
    if (!isConnected || !address) { setOpen(false); return; }
    try { setOpen(!window.localStorage.getItem(KEY(address))); } catch { /* private mode */ }
  }, [isConnected, address]);

  const done = useMemo(() => (role: Role | 'skipped') => {
    if (address) { try { window.localStorage.setItem(KEY(address), role); } catch { /* ignore */ } }
    setOpen(false);
  }, [address]);

  if (!open) return null;

  function choose(role: Role, href: string) {
    if (role === 'hirer') { setPicked('hirer'); return; } // hirers get the agent-wallet offer step
    done(role);
    router.push(href);
  }

  async function provisionAgent() {
    setProvisioning(true); setAgentErr(null);
    try {
      const w = await getAgentWallet(); // get-or-create; instant if it already exists
      setAgentAddr(w.walletAddress);
    } catch (e) {
      setAgentErr(e instanceof Error ? e.message : 'Could not set up the agent wallet — you can do it later from Post a job.');
    } finally { setProvisioning(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b2136] p-6 shadow-2xl">
        {picked !== 'hirer' ? (
          <>
            <h2 className="text-lg font-bold text-white">Welcome to Echo 👋</h2>
            <p className="mt-1 text-sm text-white/50">What brings you here? This just points you to the right place — you can always do everything.</p>
            <div className="mt-4 space-y-2">
              {ROLES.map(({ role, title, desc, icon: Icon, href }) => (
                <button
                  key={role}
                  onClick={() => choose(role, href)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition hover:border-teal-500/40 hover:bg-teal-500/[0.06]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-teal-300 group-hover:bg-teal-500/15"><Icon className="w-4.5 h-4.5" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{title}</span>
                    <span className="block text-xs text-white/45">{desc}</span>
                  </span>
                  <ChevronRight className="ml-auto w-4 h-4 shrink-0 text-white/25 group-hover:text-teal-400 transition" />
                </button>
              ))}
            </div>
            <button onClick={() => done('skipped')} className="mt-4 w-full text-center text-xs text-white/35 hover:text-white/60 transition">Skip — don&apos;t ask again</button>
          </>
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Bot className="w-5 h-5 text-teal-400" /> Want an AI agent on standby?</h2>
            <p className="mt-1 text-sm text-white/50">
              We can set up your <b className="text-white/70">agent wallet</b> now — a standing balance an autonomous agent can use
              to screen, reveal, and shortlist applicants on markets you choose. <b className="text-white/70">Optional</b>: it does
              nothing until you create an agent-run market, and you can deposit / withdraw any time.
            </p>

            {agentAddr ? (
              <div className="mt-4 rounded-lg border border-success/25 bg-success/[0.07] p-3 text-xs">
                <p className="font-medium text-success">Agent wallet ready ✓</p>
                <p className="mt-0.5 font-mono text-white/60 break-all">{agentAddr}</p>
                <p className="mt-1 text-white/45">Fund it from “Post a job” whenever you&apos;re ready to run an agent market.</p>
              </div>
            ) : (
              <>
                {!isSignedIn && <p className="mt-3 text-xs text-warning">Complete the sign-in prompt (one signature) first — the agent wallet is tied to your proven address.</p>}
                {agentErr && <p className="mt-3 text-xs text-danger break-all">{agentErr}</p>}
              </>
            )}

            <div className="mt-4 flex gap-2">
              {agentAddr ? (
                <button
                  onClick={() => { done('hirer'); router.push('/hire'); }}
                  className="flex-1 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition"
                >Go post a job</button>
              ) : (
                <>
                  <button
                    onClick={provisionAgent}
                    disabled={provisioning || !isSignedIn}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition disabled:opacity-40"
                  >
                    {provisioning && <Loader2 className="w-4 h-4 animate-spin" />} Yes, set it up
                  </button>
                  <button
                    onClick={() => { done('hirer'); router.push('/hire'); }}
                    className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 hover:text-white transition"
                  >Not now</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
