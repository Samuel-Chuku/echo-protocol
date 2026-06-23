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
import { Section } from '@/components/ui';

/**
 * Activity feed for the connected wallet. Cards, not a divide-y list — every row has its own
 * surface, a category icon, a status pill, and a chevron so it reads as obviously clickable.
 * Real filtering: status (Pending / Completed) + event-family multi-select + free-text search.
 */

type StatusFilter = 'ALL' | 'PENDING' | 'COMPLETED';

const CATEGORIES = ['Markets', 'Applications', 'Findings', 'Milestones', 'Disputes', 'Reveal stake'] as const;
type Category = typeof CATEGORIES[number];

// Per-event-name → category mapping. Used for both the filter and the card icon.
const EVENT_CATEGORY: Record<string, Category> = {
  MarketCreated: 'Markets', BountyCreated: 'Markets', DirectJobCreated: 'Markets',
  MarketClosed: 'Markets', BountyClosed: 'Markets', DirectJobCancelled: 'Markets',
  Applied: 'Applications', Revealed: 'Applications', TierAdvanced: 'Applications',
  FindingSubmitted: 'Findings', FindingAccepted: 'Findings', FindingRejected: 'Findings',
  FindingDisputed: 'Findings', FindingDisputeResolved: 'Findings',
  MilestoneSubmitted: 'Milestones', MilestoneReleased: 'Milestones',
  DisputeOpened: 'Disputes', DisputeCountered: 'Disputes', Voted: 'Disputes', DisputeResolved: 'Disputes',
  RevealFlagged: 'Reveal stake', RevealStakeReturned: 'Reveal stake', RevealStakeResolved: 'Reveal stake',
};
const categoryOf = (eventName: string): Category | null => EVENT_CATEGORY[eventName] ?? null;

// Lucide icon + tailwind tint per category. The tint is intentionally soft — these cards live
// in long lists and saturated colors fatigue fast.
const CATEGORY_STYLE: Record<Category, { Icon: typeof Circle; bg: string; fg: string }> = {
  Markets:        { Icon: Briefcase,  bg: 'bg-indigo-50',  fg: 'text-indigo-700' },
  Applications:   { Icon: UserPlus,   bg: 'bg-sky-50',     fg: 'text-sky-700' },
  Findings:       { Icon: Search,     bg: 'bg-amber-50',   fg: 'text-amber-700' },
  Milestones:     { Icon: Flag,       bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  Disputes:       { Icon: Scale,      bg: 'bg-rose-50',    fg: 'text-rose-700' },
  'Reveal stake': { Icon: Lock,       bg: 'bg-purple-50',  fg: 'text-purple-700' },
};
const FALLBACK_STYLE = { Icon: Circle, bg: 'bg-gray-100', fg: 'text-gray-600' };

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { agentId } = useAgent();

  // Live wallet event feed. limit 200 so the local filter has enough room to be useful without
  // paginating server-side; if usage grows past that, add a cursor here.
  const [{ data, fetching, error }] = useQuery<{ activity: ActivityRow[] }>({
    query: ACTIVITY_QUERY,
    variables: { address: address ?? '', limit: 200 },
    pause: !isConnected || !address,
    requestPolicy: 'cache-and-network',
  });
  const all = useMemo(() => data?.activity ?? [], [data?.activity]);

  // Filter state. status + selected categories + free-text — all client-side over the loaded set.
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
      <Section title="Activity" desc="Your events on Echo — markets, jobs, and applications.">
        <div className="sm:col-span-2 rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">Connect a wallet to see your activity.</p>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Activity" desc={agentId ? `Your events on Echo · agentId ${agentId}` : 'Your events on Echo.'}>
      <div className="sm:col-span-2 space-y-4">
        {/* Summary strip — three quick counters so the top of the page reads at a glance. */}
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Total" value={counts.ALL} active={status === 'ALL'} onClick={() => setStatus('ALL')} />
          <StatPill label="Pending" value={counts.PENDING} tone="amber" active={status === 'PENDING'} onClick={() => setStatus('PENDING')} />
          <StatPill label="Completed" value={counts.COMPLETED} tone="gray" active={status === 'COMPLETED'} onClick={() => setStatus('COMPLETED')} />
        </div>

        {/* Search + filter row. Search left-grows, filter dropdown anchors right. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search activity (event, market id, args…)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-9 py-2 text-sm rounded-md border border-gray-200 bg-white focus:border-gray-400 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border transition ${
                activeFilterCount > 0 || filterOpen
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filter
              {activeFilterCount > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  activeFilterCount > 0 && !filterOpen ? 'bg-white text-gray-900' : 'bg-gray-700 text-white'
                }`}>
                  {activeFilterCount}
                </span>
              )}
            </button>

            {filterOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg z-10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filters</span>
                  {activeFilterCount > 0 && (
                    <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-900 underline">Reset</button>
                  )}
                </div>

                <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-2 mb-1.5">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const { Icon, bg, fg } = CATEGORY_STYLE[c];
                    const on = selected.has(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleCategory(c)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition ${
                          on ? 'border-gray-900 bg-gray-900 text-white' : `border-gray-200 ${bg} ${fg} hover:border-gray-300`
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {c}
                      </button>
                    );
                  })}
                </div>

                <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-3 mb-1.5">Status</div>
                <div className="flex gap-1">
                  {(['ALL', 'PENDING', 'COMPLETED'] as StatusFilter[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`px-2.5 py-1 text-xs rounded-md transition flex-1 ${
                        status === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
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

        {/* Cards. */}
        {fetching && all.length === 0 && <p className="text-xs text-gray-400 px-1">Loading…</p>}
        {error && <p className="text-xs text-red-600 break-all px-1">{error.message} — is the indexer running on :4000?</p>}
        {!fetching && !error && filtered.length === 0 && all.length > 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">No activity matches your filters.</p>
            <button onClick={resetFilters} className="mt-2 text-xs text-gray-700 underline">Clear filters</button>
          </div>
        )}
        {!fetching && !error && all.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">Nothing here yet — your events will show up as you use Echo.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {filtered.map((r) => (
            <ActivityCard key={r.id} row={r} now={now} myAddress={address} />
          ))}
        </div>
      </div>
    </Section>
  );
}

/** Top-of-page status pill. Doubles as a quick filter chip (clicking pivots the status filter). */
function StatPill({ label, value, tone = 'gray', active, onClick }: {
  label: string; value: number; tone?: 'gray' | 'amber'; active: boolean; onClick: () => void;
}) {
  const accent = tone === 'amber' ? 'text-amber-700' : 'text-gray-700';
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2 transition ${
        active ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    </button>
  );
}

/** One activity row rendered as a card. Whole surface clickable when there's a deep link. */
function ActivityCard({ row: r, now, myAddress }: { row: ActivityRow; now: number; myAddress?: string }) {
  const href = marketHref(r, myAddress);
  const category = categoryOf(r.eventName);
  const { Icon, bg, fg } = category ? CATEGORY_STYLE[category] : FALLBACK_STYLE;
  const argsLine = summarizeArgs(r.args);

  const inner = (
    <div className="flex items-start gap-3 p-3">
      {/* Category icon — tinted square. */}
      <div className={`h-9 w-9 rounded-lg ${bg} ${fg} flex items-center justify-center shrink-0`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{eventLabel(r.eventName)}</span>
          {r.marketId !== null && <span className="text-xs text-gray-400 font-mono">market #{r.marketId}</span>}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            r.state === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {r.state === 'PENDING' ? 'Pending' : 'Done'}
          </span>
        </div>
        {argsLine && (
          <div className="text-xs text-gray-500 font-mono mt-1 truncate">{argsLine}</div>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
          <span>{timeAgo(r.createdAt, now)}</span>
          <span>·</span>
          <span>block {r.blockNumber}</span>
          <a
            href={txLink(r.txHash)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:text-gray-700"
          >
            Tx: <span className="font-mono">{short(r.txHash)}</span> <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Chevron — only shown when the row is actually clickable, so it advertises the affordance. */}
      {href && <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-700 self-center shrink-0" />}
    </div>
  );

  const cls = 'group block rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition';
  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls.replace('hover:border-gray-300 hover:shadow-sm', '')}>{inner}</div>;
}
