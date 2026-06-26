'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell as BellIcon } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
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
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-white/50 hover:bg-white/[0.06] hover:text-white transition"
        aria-label="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {rows.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center">
            {rows.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-white/10 bg-[#0d2d4a] shadow-2xl z-20 overflow-hidden flex flex-col max-h-96">
          <div className="px-4 py-2.5 border-b border-white/[0.08] shrink-0">
            <span className="text-sm font-semibold text-white">Pending</span>
          </div>
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-white/40 text-center">Nothing pending.</p>
            ) : (
              <ul className="divide-y divide-white/[0.08]">
                {rows.map((r) => {
                  const href = marketHref(r, address);
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{eventLabel(r.eventName)}</span>
                        <span className="text-xs text-white/40 shrink-0">{timeAgo(r.createdAt, now)}</span>
                      </div>
                      <div className="text-xs text-white/50 font-mono mt-0.5">
                        {r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}
                      </div>
                    </>
                  );
                  return (
                    <li key={r.id}>
                      {href ? (
                        <Link href={href} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-white/[0.04]">{body}</Link>
                      ) : (
                        <div className="px-4 py-2.5">{body}</div>
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
            className="shrink-0 border-t border-white/[0.08] px-4 py-2.5 text-center text-sm font-medium text-teal-400 hover:bg-white/[0.04]"
          >
            View all activity →
          </Link>
        </div>
      )}
    </div>
  );
}
