'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, UserPlus, Search, Flag, Scale, Lock, Circle,
  ExternalLink, ChevronRight, Filter, X,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
import { useAgent } from '@/lib/agent';
import { ACTIVITY_QUERY, eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { txLink, short } from '@/lib/format';

/**
 * Activity feed for the connected wallet. Cards, not a divide-y list — every row has its own
 * surface, a category icon, a status pill, and a chevron so it reads as obviously clickable.
 * Real filtering: status (Pending / Completed) + event-family multi-select + free-text search.
 */

type StatusFilter = 'ALL' | 'PENDING' | 'COMPLETED';

const CATEGORIES = ['Markets', 'Applications', 'Findings', 'Milestones', 'Disputes', 'Reveal stake'] as const;
type Category = typeof CATEGORIES[number];

const EVENT_CATEGORY: Record<string, Category> = {
  MarketCreated: 'Markets', BountyCreated: 'Markets', DirectJobCreated: 'Markets',
  MarketClosed: 'Markets', BountyClosed: 'Markets', DirectJobCancelled: 'Markets',
  Applied: 'Applications', Revealed: 'Applications', TierAdvanced: 'Applications',
  FindingSubmitted: 'Findings', FindingAccepted: 'Findings', FindingRejected: 'Findings',
  FindingDisputed: 'Findings', FindingDisputeResolved: 'Findings',
  MilestoneSubmitted: 'Milestones', MilestoneReleased: 'Milestones',
  DisputeOpened: 'Disputes', DisputeCountered: 'Disputes', Voted: 'Disputes', DisputeResolved: 'Disputes',
  RevealFlagged: 'Reveal stake', RevealStakeReturned: 'Reveal stake', RevealStakeResolved: 'Reveal stake',
  TierPayout: 'Applications', GhostPenalty: 'Applications', WorkerGhosted: 'Applications', RRepSlashed: 'Applications',
};
const categoryOf = (eventName: string): Category | null => EVENT_CATEGORY[eventName] ?? null;

const CATEGORY_STYLE: Record<Category, { Icon: typeof Circle; bg: string; fg: string }> = {
  Markets:        { Icon: Briefcase,  bg: 'bg-indigo-500/10',  fg: 'text-indigo-400' },
  Applications:   { Icon: UserPlus,   bg: 'bg-sky-500/10',     fg: 'text-sky-400' },
  Findings:       { Icon: Search,     bg: 'bg-warning/10',     fg: 'text-warning' },
  Milestones:     { Icon: Flag,       bg: 'bg-success/10',     fg: 'text-success' },
  Disputes:       { Icon: Scale,      bg: 'bg-danger/10',      fg: 'text-danger' },
  'Reveal stake': { Icon: Lock,       bg: 'bg-purple-500/10',  fg: 'text-purple-400' },
};
const FALLBACK_STYLE = { Icon: Circle, bg: 'bg-white/[0.06]', fg: 'text-white/40' };

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { agentId } = useAgent();

  const [{ data, fetching, error }] = useQuery<{ activity: ActivityRow[] }>({
    query: ACTIVITY_QUERY,
    variables: { address: address ?? '', limit: 200 },
    pause: !isConnected || !address,
    requestPolicy: 'cache-and-network',
  });
  const all = useMemo(() => data?.activity ?? [], [data?.activity]);

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  const toggleCategory = (c: Category) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };
  const resetFilters = () => { setStatus('ALL'); setSelected(new Set()); setSearch(''); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (status !== 'ALL' && r.state !== status) return false;
      if (selected.size > 0) {
        const cat = categoryOf(r.eventName);
        if (!cat || !selected.has(cat)) return false;
      }
      if (q) {
        const hay = [eventLabel(r.eventName), r.eventName, r.args, r.marketId !== null ? `#${r.marketId}` : ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, status, selected, search]);

  const counts = {
    ALL: all.length,
    PENDING: all.filter((r) => r.state === 'PENDING').length,
    COMPLETED: all.filter((r) => r.state === 'COMPLETED').length,
  };
  const activeFilterCount = (status !== 'ALL' ? 1 : 0) + selected.size + (search.trim() ? 1 : 0);
  const now = Math.floor(Date.now() / 1000);

  if (!isConnected) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Activity</h1>
        <p className="text-sm text-white/50 mb-6">Your events on Echo — markets, jobs, and applications.</p>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-10 text-center">
          <p className="text-sm text-white/50">Connect a wallet to see your activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Activity</h1>
      <p className="text-sm text-white/50 mb-6">
        {agentId ? `Your events on Echo · agentId ${agentId}` : 'Your events on Echo.'}
      </p>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatPill label="Total" value={counts.ALL} active={status === 'ALL'} onClick={() => setStatus('ALL')} />
        <StatPill label="Pending" value={counts.PENDING} tone="amber" active={status === 'PENDING'} onClick={() => setStatus('PENDING')} />
        <StatPill label="Completed" value={counts.COMPLETED} tone="teal" active={status === 'COMPLETED'} onClick={() => setStatus('COMPLETED')} />
      </div>

      {/* Search + filter row */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            placeholder="Search activity (event, market id, args...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm rounded-md border border-white/10 bg-white/[0.04] text-white placeholder:text-white/30 focus:border-teal-500/50 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div ref={filterRef} className="relative">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border transition ${
              activeFilterCount > 0 || filterOpen
                ? 'border-teal-500 bg-teal-500/10 text-teal-400'
                : 'border-white/10 text-white/50 hover:border-white/20 hover:text-white'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded bg-teal-500 text-ink text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-white/10 bg-[#0d2d4a] shadow-xl z-10 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/40">Filters</span>
                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="text-xs text-white/50 hover:text-white underline">Reset</button>
                )}
              </div>

              <div className="text-[10px] uppercase tracking-wide text-white/30 mt-2 mb-1.5">Category</div>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const { Icon, bg, fg } = CATEGORY_STYLE[c];
                  const on = selected.has(c);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleCategory(c)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition ${
                        on ? 'border-teal-500 bg-teal-500/10 text-teal-400' : `border-white/10 ${bg} ${fg} hover:border-white/20`
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {c}
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] uppercase tracking-wide text-white/30 mt-3 mb-1.5">Status</div>
              <div className="flex gap-1">
                {(['ALL', 'PENDING', 'COMPLETED'] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-2.5 py-1 text-xs rounded-md transition flex-1 ${
                      status === s ? 'bg-teal-500 text-ink font-semibold' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    {s === 'ALL' ? 'All' : s === 'PENDING' ? 'Pending' : 'Done'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {fetching && all.length === 0 && <p className="text-xs text-white/40 px-1">Loading...</p>}
      {error && <p className="text-xs text-danger break-all px-1">{error.message} — is the indexer running on :4000?</p>}
      {!fetching && !error && filtered.length === 0 && all.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-white/50">No activity matches your filters.</p>
          <button onClick={resetFilters} className="mt-2 text-xs text-teal-400 underline">Clear filters</button>
        </div>
      )}
      {!fetching && !error && all.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <p className="text-sm text-white/50">No activity yet.</p>
          <p className="text-xs text-white/30 mt-1">Submit to a market or post a job to get started.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {filtered.map((r) => (
          <ActivityCard key={r.id} row={r} now={now} myAddress={address} />
        ))}
      </div>
    </div>
  );
}

function StatPill({ label, value, tone = 'teal', active, onClick }: {
  label: string; value: number; tone?: 'teal' | 'amber'; active: boolean; onClick: () => void;
}) {
  const accent = tone === 'amber' ? 'text-warning' : 'text-teal-400';
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2 transition ${
        active ? 'border-teal-500/40 bg-teal-500/10' : 'border-white/10 bg-white/[0.04] hover:border-white/20'
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
    </button>
  );
}

function ActivityCard({ row: r, now, myAddress }: { row: ActivityRow; now: number; myAddress?: string }) {
  const href = marketHref(r, myAddress);
  const category = categoryOf(r.eventName);
  const { Icon, bg, fg } = category ? CATEGORY_STYLE[category] : FALLBACK_STYLE;
  const argsLine = summarizeArgs(r.args);

  const inner = (
    <div className="flex items-start gap-3 p-3">
      <div className={`h-9 w-9 rounded-lg ${bg} ${fg} flex items-center justify-center shrink-0`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{eventLabel(r.eventName)}</span>
          {r.marketId !== null && <span className="text-xs text-white/40 font-mono">market #{r.marketId}</span>}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            r.state === 'PENDING' ? 'bg-warning/10 text-warning' : 'bg-white/[0.06] text-white/40'
          }`}>
            {r.state === 'PENDING' ? 'Pending' : 'Done'}
          </span>
        </div>
        {argsLine && (
          <div className="text-xs text-white/50 font-mono mt-1 truncate">{argsLine}</div>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-white/30">
          <span>{timeAgo(r.createdAt, now)}</span>
          <span>·</span>
          <span>block {r.blockNumber}</span>
          <span className="inline-flex items-center gap-1">
            Tx: <span className="font-mono">{short(r.txHash)}</span>
          </span>
        </div>
      </div>

      {href && <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/60 self-center shrink-0" />}
    </div>
  );

  const cls = 'group block rounded-xl border border-white/10 bg-white/[0.04] transition';
  const interactiveCls = `${cls} hover:border-white/20 hover:bg-white/[0.06]`;

  return (
    <div className="relative">
      {href ? <Link href={href} className={interactiveCls}>{inner}</Link> : <div className={cls}>{inner}</div>}
      <a
        href={txLink(r.txHash)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-2 right-3 p-1 text-white/20 hover:text-white"
        title="View transaction on Arcscan"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
