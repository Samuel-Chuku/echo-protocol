'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Inbox, CheckCircle2, Clock, Briefcase, User } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
import { useAgent } from '@/lib/agent';
import { ACTIVITY_QUERY, eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { txLink, usdc } from '@/lib/format';
import { StatCard, EmptyState, Button, Tabs, CARD_CLASS } from '@/components/ui';

/**
 * Activity feed for the connected wallet, read from the indexer (#2, #10). Splits PENDING (waiting on
 * an action) from COMPLETED, with per-tab counts, and deep-links each row to the right market view.
 */
type Filter = 'ALL' | 'PENDING' | 'COMPLETED' | 'MY_MARKETS';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'MY_MARKETS', label: 'My markets' },
];

/** Amount/award field from an event's decoded args JSON, in human USDC, if present. */
function earnedFrom(json: string): number {
  try {
    const args = JSON.parse(json);
    const raw = args.award ?? args.amount;
    return raw !== undefined ? Number(usdc(BigInt(raw))) : 0;
  } catch {
    return 0;
  }
}

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { agentId } = useAgent();
  const [filter, setFilter] = useState<Filter>('ALL');

  // One query (no status filter) → derive counts + filter client-side, so the tabs always show totals.
  const [{ data, fetching, error }] = useQuery<{ activity: ActivityRow[] }>({
    query: ACTIVITY_QUERY,
    variables: { address: address ?? '', limit: 100 },
    pause: !isConnected || !address,
  });
  const all = data?.activity ?? [];
  const now = Math.floor(Date.now() / 1000);

  const withHref = useMemo(() => all.map((r) => ({ row: r, href: marketHref(r, address) })), [all, address]);
  const pending = all.filter((r) => r.state === 'PENDING');
  const completed = all.filter((r) => r.state === 'COMPLETED');
  const totalEarned = useMemo(
    () => completed.filter((r) => r.actor?.toLowerCase() === address?.toLowerCase()).reduce((sum, r) => sum + earnedFrom(r.args), 0),
    [completed, address],
  );

  const counts: Record<Filter, number> = {
    ALL: all.length,
    PENDING: pending.length,
    COMPLETED: completed.length,
    MY_MARKETS: withHref.filter((x) => x.href?.startsWith('/hire/')).length,
  };

  const filtered = withHref.filter(({ row, href }) => {
    if (filter === 'PENDING') return row.state === 'PENDING';
    if (filter === 'COMPLETED') return row.state === 'COMPLETED';
    if (filter === 'MY_MARKETS') return href?.startsWith('/hire/');
    return true;
  });
  const asWorker = filtered.filter((x) => x.href?.startsWith('/apply/'));
  const asRequester = filtered.filter((x) => x.href?.startsWith('/hire/'));
  const other = filtered.filter((x) => !x.href);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Activity</h1>
      <p className="text-sm text-white/50 mb-6">
        {isConnected && agentId ? `Your events on Echo · agentId ${agentId}` : 'Your events on Echo, markets, jobs, and applications.'}
      </p>

      {!isConnected ? (
        <EmptyState icon={Inbox} title="Connect a wallet" desc="Connect a wallet to see your activity across markets and jobs." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Active" value={pending.length} sub="needs attention" />
            <StatCard label="Total earned" value={`$${totalEarned.toFixed(2)}`} sub="USDC, completed" />
            <StatCard label="Completed" value={completed.length} sub="all time" />
          </div>

          <div className="mb-4"><Tabs options={FILTERS} value={filter} onChange={setFilter} counts={counts} /></div>

          {fetching && all.length === 0 && <p className="text-sm text-white/40">Loading…</p>}
          {error && <p className="text-sm text-danger break-all">{error.message} — is the indexer running on :4000?</p>}
          {!fetching && !error && all.length === 0 && (
            <EmptyState
              icon={Inbox}
              title="Nothing here yet"
              desc="Once you apply to a market or post a job, your activity will show up here."
              action={
                <div className="flex gap-2">
                  <Button href="/apply">Browse markets</Button>
                  <Button variant="secondary" href="/hire">Post a job</Button>
                </div>
              }
            />
          )}

          {filtered.length > 0 && (
            <div className="space-y-6">
              {asWorker.length > 0 && <ActivityGroup title="As worker" icon={User} items={asWorker} now={now} />}
              {asRequester.length > 0 && <ActivityGroup title="As requester" icon={Briefcase} items={asRequester} now={now} />}
              {other.length > 0 && <ActivityGroup title="Other" icon={Clock} items={other} now={now} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityGroup({
  title, icon: Icon, items, now,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: { row: ActivityRow; href: string | null }[];
  now: number;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-white/50 flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h2>
      <div className={CARD_CLASS}>
        <ul className="divide-y divide-white/[0.08]">
          {items.map(({ row: r, href }) => {
            const body = (
              <>
                <span className={`shrink-0 mt-0.5 ${r.state === 'PENDING' ? 'text-warning' : 'text-success'}`}>
                  {r.state === 'PENDING' ? <Clock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-white">{eventLabel(r.eventName)}</span>
                  <span className="block text-xs text-white/40 font-mono">
                    {r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}
                  </span>
                </span>
                <span className="text-xs text-white/40 shrink-0">{timeAgo(r.createdAt, now)}</span>
              </>
            );
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                {href ? (
                  <Link href={href} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80">{body}</Link>
                ) : (
                  <span className="flex items-center gap-3 flex-1 min-w-0">{body}</span>
                )}
                <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="text-white/20 hover:text-white shrink-0">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
