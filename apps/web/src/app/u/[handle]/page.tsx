'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Copy, Check, Download, Share2, Lock, Award } from 'lucide-react';
import { getAddress } from 'viem';
import { useQuery, gql } from 'urql';
import { eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { short, modeName, modeBadgeTone, txLink, addrLink, usdc } from '@/lib/format';
import { Badge, Button, EmptyState, StatCard, CARD_CLASS } from '@/components/ui';

/**
 * Public profile (#7, profiles-only — reputation scoring stays deferred). Aggregates what the indexer
 * already knows about an address: markets they created (requester), applications they made (worker),
 * and recent activity. No P/R/G-Rep math — that's not implemented anywhere yet, so it's shown as
 * "coming soon" rather than a fabricated score.
 */
const PROFILE = gql`
  query Profile($address: String!) {
    asRequester: markets(requester: $address, limit: 100) {
      id mode subject status applicantCount requesterAgentId
    }
    asWorker: applications(participant: $address) {
      id marketId agentId tierReached status createdAt
    }
    activity(address: $address, limit: 50) {
      id blockNumber txHash eventName marketId actor args state createdAt
    }
  }
`;

type Mkt = { id: number; mode: number; subject: string | null; status: string; applicantCount: number; requesterAgentId: string | null };
type App = { id: string; marketId: number; agentId: string | null; tierReached: number; status: string; createdAt: number };
type ProfileData = { asRequester: Mkt[]; asWorker: App[]; activity: ActivityRow[] };

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

  const [{ data, fetching, error }] = useQuery<ProfileData>({
    query: PROFILE,
    variables: { address: address ?? '' },
    pause: !address,
  });

  if (!address) {
    return <p className="text-sm text-danger">Not a valid address: {handle}</p>;
  }
  const addr: `0x${string}` = address;

  const markets = data?.asRequester ?? [];
  const apps = data?.asWorker ?? [];
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

  const isNewUser = !agentId && markets.length === 0 && apps.length === 0;

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
                <span className="text-lg font-bold text-white">0<span className="text-white/30 text-sm font-normal"> / 1000</span></span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Start building your reputation</h3>
              <p className="mt-1 text-sm text-white/50 max-w-sm">Complete your first market to earn points.</p>
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

      {fetching && !data && <p className="text-sm text-white/40">Loading…</p>}
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
        <div className={CARD_CLASS}>
          {activity.length === 0 ? (
            <EmptyState icon={Award} title="No activity yet" desc="Nothing recorded for this address yet." />
          ) : (
            <ul className="divide-y divide-white/[0.08]">
              {activity.map((r) => {
                const href = marketHref(r, address);
                const body = (
                  <>
                    <Badge tone={r.state === 'PENDING' ? 'warning' : 'neutral'}>{r.state === 'PENDING' ? 'Pending' : 'Done'}</Badge>
                    <span className="flex-1 min-w-0">
                      <b className="font-medium text-white">{eventLabel(r.eventName)}</b>
                      <span className="text-white/40 font-mono text-xs ml-2">{r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}</span>
                    </span>
                    <span className="text-xs text-white/40 shrink-0">{timeAgo(r.createdAt, now)}</span>
                  </>
                );
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    {href ? <Link href={href} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80">{body}</Link> : <span className="flex items-center gap-3 flex-1 min-w-0">{body}</span>}
                    <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="text-white/20 hover:text-white shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
