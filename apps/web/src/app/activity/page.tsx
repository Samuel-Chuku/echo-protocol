'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
import { useAgent } from '@/lib/agent';
import { ACTIVITY_QUERY, eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';
import { txLink } from '@/lib/format';
import { Section, Card } from '@/components/ui';

/**
 * Activity feed for the connected wallet, read from the indexer (#2, #10). Splits PENDING (waiting on
 * an action) from COMPLETED, with per-tab counts, and deep-links each row to the right market view.
 * Replaces the old landing's raw getLogs scan — the source of the "RPC request failed" errors.
 */
type Filter = 'ALL' | 'PENDING' | 'COMPLETED';

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
  const pending = all.filter((r) => r.state === 'PENDING');
  const counts = { ALL: all.length, PENDING: pending.length, COMPLETED: all.length - pending.length };
  const rows = filter === 'ALL' ? all : all.filter((r) => r.state === filter);
  const now = Math.floor(Date.now() / 1000);

  return (
    <Section title="Activity" desc={isConnected && agentId ? `Your events on Echo · agentId ${agentId}` : 'Your events on Echo — markets, jobs, and applications.'}>
      <div className="sm:col-span-2">
        {!isConnected ? (
          <Card title="Connect a wallet"><p className="text-sm text-gray-400">Connect a wallet to see your activity.</p></Card>
        ) : (
          <Card title={pending.length > 0 ? `${pending.length} item${pending.length === 1 ? '' : 's'} need attention` : 'Your activity'}>
            <div className="flex gap-1">
              {(['ALL', 'PENDING', 'COMPLETED'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-md transition ${filter === f ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {f[0] + f.slice(1).toLowerCase()} <span className={filter === f ? 'text-gray-300' : 'text-gray-400'}>{counts[f]}</span>
                </button>
              ))}
            </div>

            {fetching && all.length === 0 && <p className="text-xs text-gray-400">Loading…</p>}
            {error && <p className="text-xs text-red-600 break-all">{error.message} — is the indexer running on :4000?</p>}
            {!fetching && !error && rows.length === 0 && <p className="text-xs text-gray-400">Nothing here.</p>}

            {rows.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const href = marketHref(r, address);
                  const body = (
                    <>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${r.state === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.state === 'PENDING' ? 'Pending' : 'Done'}
                      </span>
                      <span className="flex-1 min-w-0">
                        <b className="font-medium">{eventLabel(r.eventName)}</b>
                        <span className="text-gray-500 font-mono text-xs ml-2">
                          {r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}
                        </span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{timeAgo(r.createdAt, now)}</span>
                    </>
                  );
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2">
                      {href ? (
                        <Link href={href} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-70">{body}</Link>
                      ) : (
                        <span className="flex items-center gap-3 flex-1 min-w-0">{body}</span>
                      )}
                      <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-gray-700 shrink-0">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>
    </Section>
  );
}
