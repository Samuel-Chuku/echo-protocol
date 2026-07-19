'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Copy, Check, Download, Share2, Lock, Award, Bot, Users, ArrowRight } from 'lucide-react';
import { getAddress } from 'viem';
import { useAccount } from 'wagmi';
import { useQuery, gql } from 'urql';
import { eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { short, modeName, modeBadgeTone, txLink, addrLink, usdc, usdcShort } from '@/lib/format';
import { Badge, Button, EmptyState, StatCard, CARD_CLASS, Card, KV, SkeletonCard } from '@/components/ui';
import { SendUsdcCard, useIsPasskeyWallet } from '@/components/SendUsdc';
import { AgentWallet } from '@/components/AgentWallet';
import { peekAgentWallet } from '@/lib/agentApi';

/**
 * Public profile. Aggregates what the indexer knows about an address: markets they created
 * (requester), applications they made (worker), reputation rollup from EchoHook, and recent
 * activity.
 */
const PROFILE = gql`
  query Profile($address: String!) {
    asRequester: markets(requester: $address, limit: 100) {
      id mode subject status applicantCount requesterAgentId
    }
    asWorker: applications(participant: $address) {
      id marketId agentId tierReached status createdAt
    }
    reputation(address: $address) {
      jobsCompleted totalEarned tierSum ghostCount totalSlashed rRepSlashes lastEventBlock
    }
    activity(address: $address, limit: 50) {
      id blockNumber txHash eventName marketId actor args state createdAt
    }
  }
`;

type Mkt = { id: number; mode: number; subject: string | null; status: string; applicantCount: number; requesterAgentId: string | null };
type App = { id: string; marketId: number; agentId: string | null; tierReached: number; status: string; createdAt: number };
type Rep = {
  jobsCompleted: number; totalEarned: string; tierSum: number;
  ghostCount: number; totalSlashed: string; rRepSlashes: number; lastEventBlock: number;
};
type ProfileData = { asRequester: Mkt[]; asWorker: App[]; reputation: Rep | null; activity: ActivityRow[] };

// Profile shows the most recent 20 as cards; the full history lives on the /activity page.
const PROFILE_ACTIVITY_PREVIEW = 20;

function earnedFrom(json: string): number {
  try {
    const args = JSON.parse(json);
    const raw = args.award ?? args.amount;
    return raw !== undefined ? Number(usdc(BigInt(raw))) : 0;
  } catch {
    return 0;
  }
}

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  // Markets/applications are stored checksummed; normalise so the URL matches regardless of casing.
  const address = useMemo(() => { try { return getAddress(handle); } catch { return null; } }, [handle]);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Stable variables identity — an inline literal re-triggers urql's cache read during render.
  const vars = useMemo(() => ({ address: address ?? '' }), [address]);
  const [{ data, fetching, error }] = useQuery<ProfileData>({
    query: PROFILE,
    variables: vars,
    pause: !address,
  });

  if (!address) {
    return <p className="text-sm text-danger">Not a valid address: {handle}</p>;
  }
  const addr: `0x${string}` = address;

  const markets = data?.asRequester ?? [];
  const apps = data?.asWorker ?? [];
  const rep = data?.reputation ?? null;
  const activity = data?.activity ?? [];
  const agentId = apps.find((a) => a.agentId && a.agentId !== '0')?.agentId
    ?? markets.find((m) => m.requesterAgentId && m.requesterAgentId !== '0')?.requesterAgentId
    ?? null;
  const totalEarned = activity
    .filter((r) => r.state === 'COMPLETED' && r.actor?.toLowerCase() === address.toLowerCase())
    .reduce((sum, r) => sum + earnedFrom(r.args), 0);
  const now = Math.floor(Date.now() / 1000);
  const hue = parseInt(address.slice(2, 8), 16) % 360;

  function copyAddress() {
    navigator.clipboard.writeText(addr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  function shareProfile() {
    navigator.clipboard.writeText(window.location.href).then(() => { setShared(true); setTimeout(() => setShared(false), 1500); });
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ address, markets, applications: apps, activity }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-profile-${address}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const { address: connected } = useAccount();
  const isPasskey = useIsPasskeyWallet();
  const isOwn = !!connected && connected.toLowerCase() === address.toLowerCase();
  const showSend = isOwn && isPasskey;
  const isNewUser = !agentId && markets.length === 0 && apps.length === 0;

  // Agent wallet management (own profile only). Peek — never lazily provision a Circle DCW just by
  // opening a profile; getAgentWallet() (inside <AgentWallet/>) is get-or-create, so we only mount it
  // when a wallet already exists or the owner explicitly asks for one.
  const [agentWalletExists, setAgentWalletExists] = useState<boolean | null>(null);
  const [agentSetupOpen, setAgentSetupOpen] = useState(false);
  useEffect(() => {
    if (!isOwn) { setAgentWalletExists(null); return; }
    let active = true;
    peekAgentWallet(address).then((w) => { if (active) setAgentWalletExists(w.exists); }).catch(() => { if (active) setAgentWalletExists(false); });
    return () => { active = false; };
  }, [isOwn, address]);

  return (
    <div>
      <div className="flex flex-col items-center text-center gap-4 mb-6 sm:flex-row sm:items-start sm:text-left">
        <span
          className="h-16 w-16 rounded-full border border-white/10 shrink-0 flex items-center justify-center text-lg font-bold text-white/90"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 75% 45%))` }}
        >
          {address.slice(2, 4).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0 flex flex-col items-center sm:items-start">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white font-mono truncate">{short(address)}</h1>
            <a href={addrLink(address)} target="_blank" rel="noreferrer" className="text-white/30 hover:text-white"><ExternalLink className="w-4 h-4" /></a>
          </div>
          <button onClick={copyAddress} className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white font-mono break-all transition">
            {address} {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
          <div className="mt-2 flex items-center gap-2">
            {agentId && <Badge tone="teal">agentId {agentId}</Badge>}
            <Badge tone="neutral">Arc Testnet</Badge>
          </div>
        </div>
        <div className="flex flex-row gap-2 shrink-0 sm:flex-col">
          <Button variant="secondary" onClick={shareProfile}><Share2 className="w-3.5 h-3.5" /> {shared ? 'Copied!' : 'Share profile'}</Button>
          <Button variant="secondary" onClick={exportData}><Download className="w-3.5 h-3.5" /> Export data</Button>
        </div>
      </div>

      {showSend && (
        <div id="send" className="scroll-mt-24 mb-8">
          <h2 className="text-lg font-bold text-white mb-3">Send USDC</h2>
          <SendUsdcCard />
        </div>
      )}

      {/* Agent wallet management — own profile only. View, deposit, withdraw the standing Circle DCW
          that funds + runs your agent markets. If none exists yet, an explicit opt-in creates one
          (AgentWallet's load is get-or-create); a bare profile visit never provisions. */}
      {isOwn && agentWalletExists !== null && (
        <div id="agent-wallet" className="scroll-mt-24 mb-8">
          <h2 className="text-lg font-bold text-white mb-3">Agent wallet</h2>
          {agentWalletExists || agentSetupOpen ? (
            <AgentWallet />
          ) : (
            <div className={CARD_CLASS}>
              <p className="text-sm text-white/60 flex items-start gap-2">
                <Bot className="w-4 h-4 shrink-0 mt-0.5 text-teal-400" />
                No agent wallet yet. It&apos;s a standing USDC account an AI agent uses to create and run
                markets for you — screening applicants, paying reveal fees, and advancing the best ones.
              </p>
              <Button variant="secondary" className="mt-3" onClick={() => setAgentSetupOpen(true)}>
                Set up my agent wallet
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Introducer — moved out of the nav to here + the footer (user ask 2026-07-19). Prominent,
          full-width, gradient accent so it reads as a protocol offering rather than filler. */}
      {isOwn && (
        <Link
          href="/attribution"
          className="group mb-8 flex items-center gap-4 rounded-2xl border border-purple-500/25 bg-gradient-to-r from-purple-500/[0.12] via-purple-500/[0.04] to-transparent p-5 transition hover:border-purple-500/50"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
            <Users className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-white">Want to be an Introducer?</span>
            <span className="mt-0.5 block text-sm text-white/50">
              Introduce great workers to Echo and earn a slice of every payout they win — automatically, on-chain, for years.
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 transition group-hover:bg-purple-500/25">
            Start earning <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Total earned" value={`$${totalEarned.toFixed(2)}`} sub="USDC, completed" />
        <StatCard label="Applications" value={apps.length} />
        <StatCard label="Markets created" value={markets.length} />
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-white">Reputation</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">Score, breakdown, and badges land once on-chain reputation scoring ships.</p>
        <div className={CARD_CLASS}>
          {isNewUser ? (
            <div className="flex flex-col items-center text-center py-6 px-4">
              <div className="h-28 w-28 rounded-full border-4 border-teal-500/30 flex items-center justify-center">
                <span className="text-lg font-bold text-white/40">—<span className="text-white/25 text-sm font-normal"> / 1000</span></span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Start building your reputation</h3>
              <p className="mt-1 text-sm text-white/50 max-w-sm">Complete your first market to start a record. Scoring goes live once on-chain reputation ships.</p>
            </div>
          ) : (
            <EmptyState
              icon={Award}
              title="Reputation scoring coming soon"
              desc="Echo will compute a 0-1000 score from on-chain history once scoring goes live. For now, the activity below is the real record."
            />
          )}
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 justify-items-center max-w-xs mx-auto sm:max-w-none">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/20">
                <Lock className="w-4 h-4" />
              </span>
            ))}
          </div>
        </div>
      </section>

      {fetching && !data && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      )}
      {error && <p className="text-sm text-danger break-all">{error.message} — is the indexer running on :4000?</p>}

      {isNewUser ? (
        <section className="mb-8">
          <h2 className="text-lg font-bold text-white">History</h2>
          <p className="text-sm text-white/50 mt-0.5 mb-3">Markets created and applications submitted by this address.</p>
          <div className={CARD_CLASS}>
            <EmptyState
              icon={Award}
              title="Your on-chain history will appear here"
              desc="Browse open markets to get started."
              action={<Button href="/apply">Browse markets</Button>}
            />
          </div>
        </section>
      ) : (
      <>
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white">As requester</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">Markets this address created.</p>
        <div className={CARD_CLASS}>
          {markets.length === 0 ? (
            <EmptyState icon={Award} title="No markets created" desc="This address hasn't posted any work on Echo yet." />
          ) : (
            <ul className="divide-y divide-white/[0.08]">
              {markets.map((m) => (
                <li key={m.id}>
                  <Link href={`/apply/${m.id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.03] -mx-1 px-1 rounded">
                    <span className="font-mono text-sm text-white/40 w-10">#{m.id}</span>
                    <Badge tone={modeBadgeTone(m.mode)}>{modeName(m.mode)}</Badge>
                    <span className="flex-1 text-sm font-medium text-white truncate">{m.subject || <span className="text-white/30 italic">untitled</span>}</span>
                    <span className="text-xs text-white/40">{m.status} · {m.applicantCount} appl.</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-white">As worker</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">Applications this address submitted.</p>
        <div className={CARD_CLASS}>
          {apps.length === 0 ? (
            <EmptyState icon={Award} title="No applications" desc="This address hasn't applied to any markets yet." />
          ) : (
            <ul className="divide-y divide-white/[0.08]">
              {apps.map((a) => (
                <li key={a.id}>
                  <Link href={`/apply/${a.marketId}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.03] -mx-1 px-1 rounded">
                    <span className="font-mono text-sm text-white/40 w-10">#{a.marketId}</span>
                    <span className="flex-1 text-sm text-white">{a.status}</span>
                    <span className="text-xs text-white/40">tier {a.tierReached}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      </>
      )}

      <section>
        <h2 className="text-lg font-bold text-white">Recent activity</h2>
        <p className="text-sm text-white/50 mt-0.5 mb-3">Latest events involving this address.</p>
        {activity.length === 0 ? (
          <div className={CARD_CLASS}>
            <EmptyState icon={Award} title="No activity yet" desc="Nothing recorded for this address yet." />
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {activity.slice(0, PROFILE_ACTIVITY_PREVIEW).map((r) => {
                const href = marketHref(r, address);
                return (
                  <div key={r.id} className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${r.state === 'PENDING' ? 'bg-warning' : 'bg-teal-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        {href ? (
                          <Link href={href} className="text-sm font-medium text-white truncate hover:text-teal-400 transition">{eventLabel(r.eventName)}</Link>
                        ) : (
                          <span className="text-sm font-medium text-white truncate">{eventLabel(r.eventName)}</span>
                        )}
                        <span className="shrink-0 text-[10px] text-white/40 tabular-nums">{timeAgo(r.createdAt, now)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {r.state === 'PENDING' && <Badge tone="warning">Pending</Badge>}
                        <span className="text-xs text-white/50 font-mono truncate">{r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}</span>
                      </div>
                    </div>
                    <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" title="View transaction on Arcscan" aria-label="View transaction on Arcscan" className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/40 hover:border-white/30 hover:text-white transition"><ExternalLink className="w-3.5 h-3.5" /></a>
                  </div>
                );
              })}
            </div>
            <Link href="/activity" className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs font-medium text-white/60 hover:border-white/25 hover:text-white transition">
              View all activity <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
