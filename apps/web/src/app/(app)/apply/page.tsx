'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useQuery, gql } from 'urql';
import { Badge, Button, EmptyState, CARD_CLASS, Tabs, SkeletonCard } from '@/components/ui';
import { usdc, short, modeName, modeBadgeTone, ago, duration } from '@/lib/format';

/**
 * Worker home — browse open markets from the indexer. Each card previews its payout tiers inline
 * (expandable, no navigation needed) and links into the full job page.
 */
const OPEN_MARKETS = gql`
  query OpenMarkets {
    markets(openOnly: true, limit: 100) {
      id
      mode
      requester
      subject
      description
      status
      escrowTotal
      applicantCount
      stakeRequired
      createdAt
      tiers
      createdAt
      ghostDeadline
    }
  }
`;

type MarketRow = {
  id: number;
  mode: number;
  requester: string;
  subject: string | null;
  description: string | null;
  status: string;
  escrowTotal: string | null;
  applicantCount: number;
  stakeRequired: string | null;
  createdAt: number;
  tiers: string[] | null;
  ghostDeadline: number | null;
};

type Filter = 'ALL' | '0' | '1' | '2';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: '0', label: 'Open / Reveal' },
  { value: '2', label: 'Bounty' },
  { value: '1', label: 'Direct job' },
];

type SortKey = 'newest' | 'payout' | 'applicants' | 'stake';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'payout', label: 'Highest payout' },
  { value: 'applicants', label: 'Most applicants' },
  { value: 'stake', label: 'Lowest stake' },
];
const SORT_FNS: Record<SortKey, (a: MarketRow, b: MarketRow) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  payout: (a, b) => Number(BigInt(b.escrowTotal || '0') - BigInt(a.escrowTotal || '0')),
  applicants: (a, b) => b.applicantCount - a.applicantCount,
  stake: (a, b) => Number(BigInt(a.stakeRequired || '0') - BigInt(b.stakeRequired || '0')),
};

export default function ApplyPage() {
  const [{ data, fetching, error }, refetch] = useQuery<{ markets: MarketRow[] }>({ query: OPEN_MARKETS });
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<SortKey>('newest');
  const [search, setSearch] = useState('');
  const rows = data?.markets ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const f of FILTERS) if (f.value !== 'ALL') c[f.value] = rows.filter((m) => String(m.mode) === f.value).length;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((m) => filter === 'ALL' || String(m.mode) === filter)
      .filter((m) => !q || m.subject?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q))
      .sort(SORT_FNS[sort]);
  }, [rows, filter, search, sort]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Find work</h1>
      <p className="text-sm text-white/50 mb-1">Open markets on Echo. Most require a $5 stake to apply, refunded once you deliver.</p>
      <p className="text-xs text-white/30 mb-6">If you withdraw before being revealed, your stake comes back in full.</p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search markets by title or description"
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-white/[0.05] border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-teal-500/40 transition-colors min-h-[44px]"
        />
      </div>

      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-2 text-sm rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-teal-500/40 transition-colors min-h-[44px]"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            onClick={() => refetch({ requestPolicy: 'network-only' })}
            className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition shrink-0 min-h-[44px] px-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {fetching && filtered.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
        </div>
      )}
      {error && <p className="text-sm text-danger break-all">{error.message} — is the indexer running on :4000?</p>}
      {!fetching && !error && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          title="No markets here yet"
          desc="Nothing matches this filter right now. Check back soon or try a different market type."
          action={<Button variant="secondary" onClick={() => { setFilter('ALL'); setSearch(''); }}>View all markets</Button>}
        />
      )}

      <div className="space-y-3">
        {filtered.map((m) => <MarketCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}

const TIER_LABELS = ['Reveal', 'Shortlist', 'Final', 'Ghost'];
const STATUS_TONE = { active: 'success', closed: 'neutral', cancelled: 'danger' } as const;

function MarketCard({ m }: { m: MarketRow }) {
  const [open, setOpen] = useState(false);
  // Only Open/Reveal markets carry tier amounts; ignore empty/all-zero tier arrays.
  const tiers = (m.tiers ?? []).filter((t) => t && t !== '0');
  const hasTiers = tiers.length > 0;

  return (
    <div className={CARD_CLASS}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="font-mono text-sm text-white/40 w-10 shrink-0 pt-0.5">#{m.id}</span>
        <Badge tone={modeBadgeTone(m.mode)}>{modeName(m.mode)}</Badge>
        <Badge tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{m.status}</Badge>
        <span className="flex-1 min-w-[60%] sm:min-w-0">
          <span className="block text-sm font-semibold text-white truncate">{m.subject || <span className="text-white/30 italic">untitled market</span>}</span>
          {m.description && <span className="block text-xs text-white/50 line-clamp-2">{m.description}</span>}
        </span>
        <span className="text-xs text-white/40 shrink-0 pt-0.5 text-right ml-auto sm:ml-0">
          {short(m.requester)} · {m.applicantCount} appl.
          {m.escrowTotal && <span className="block font-mono text-teal-400">${usdc(BigInt(m.escrowTotal))} escrow</span>}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-white/30 pl-[52px]">
        <span>Created {ago(m.createdAt)}</span>
        {m.ghostDeadline ? <span>· Runs {duration(m.ghostDeadline)}</span> : null}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {hasTiers ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-sm font-medium text-white/60 hover:text-white transition min-h-[44px] sm:min-h-0"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Tier structure
          </button>
        ) : <span className="text-xs text-white/30">No tier structure</span>}

        <Link
          href={`/apply/${m.id}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-ink hover:bg-teal-400 transition min-h-[44px] w-full sm:w-auto"
        >
          View job →
        </Link>
      </div>

      {open && hasTiers && (
        <ol className="mt-3 space-y-2 border-t border-white/[0.08] pt-3">
          {tiers.map((t, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-ink">{i + 1}</span>
              <span className="flex-1 text-xs sm:text-sm font-medium text-white">{TIER_LABELS[i] ?? `Tier ${i + 1}`}</span>
              <span className="text-xs sm:text-sm font-mono text-teal-400">${usdc(BigInt(t))}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
