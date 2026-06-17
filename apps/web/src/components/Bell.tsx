'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell as BellIcon, ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
import { txLink, short } from '@/lib/format';
import { ACTIVITY_QUERY, eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';

/**
 * Notification bell. Reads the connected wallet's PENDING activity from the indexer (#10) and badges
 * the count. Pending = something is waiting on an action (a new application, a submitted finding, an
 * open dispute). Hidden until a wallet is connected.
 */
export function Bell() {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [{ data }] = useQuery<{ activity: ActivityRow[] }>({
    query: ACTIVITY_QUERY,
    variables: { address: address ?? '', status: 'PENDING', limit: 20 },
    pause: !isConnected || !address,
  });
  const rows = data?.activity ?? [];

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!isConnected) return null;
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition"
        aria-label="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {rows.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {rows.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg z-20 overflow-hidden flex flex-col max-h-96">
          <div className="px-4 py-2.5 border-b border-gray-100 shrink-0">
            <span className="text-sm font-semibold">Pending</span>
          </div>
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing pending.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const href = marketHref(r, address);
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{eventLabel(r.eventName)}</span>
                        <span className="text-xs text-gray-400 shrink-0">{timeAgo(r.createdAt, now)}</span>
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5 pr-28 truncate">
                        {r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}
                      </div>
                    </>
                  );
                  return (
                    <li key={r.id} className="relative">
                      {href ? (
                        <Link href={href} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-gray-50">{body}</Link>
                      ) : (
                        <div className="px-4 py-2.5">{body}</div>
                      )}
                      {/* Tx link sits outside the row Link to avoid a nested anchor. */}
                      {r.txHash && (
                        <a
                          href={txLink(r.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute bottom-2.5 right-4 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
                        >
                          Tx: <span className="font-mono">{short(r.txHash)}</span> <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {/* Sticky footer — always visible regardless of scroll */}
          <Link
            href="/activity"
            onClick={() => setOpen(false)}
            className="shrink-0 border-t border-gray-100 px-4 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View all activity →
          </Link>
        </div>
      )}
    </div>
  );
}
