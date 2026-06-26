'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell as BellIcon, Check, ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useQuery } from 'urql';
import { txLink, short } from '@/lib/format';
import { ACTIVITY_QUERY, eventLabel, summarizeArgs, timeAgo, marketHref, type ActivityRow } from '@/lib/activity';

/**
 * Notification bell. Polls the indexer for the wallet's recent activity (PENDING = still needs
 * someone's action, COMPLETED = past). Two state axes:
 *  - READ vs UNREAD: a per-wallet `lastReadBlock` lives in localStorage; rows above that block
 *    are "new". Mark-all-read advances it to the current max block — instant, no server state.
 *  - PENDING vs COMPLETED: comes from the indexer's event-name classifier.
 *
 * The red badge only fires when there's an UNREAD-and-PENDING intersection — the situation that
 * actually demands attention. Read pending rows stay visible (still amber-dot in the list) but
 * stop counting toward the badge. Polled every 15s so it refreshes itself.
 */
export function Bell() {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [lastReadBlock, setLastReadBlock] = useState<number>(0);

  // urql doesn't expose polling natively in the v3 API we're on; do it manually.
  const [{ data }, refetch] = useQuery<{ activity: ActivityRow[] }>({
    query: ACTIVITY_QUERY,
    variables: { address: address ?? '', limit: 20 },
    pause: !isConnected || !address,
    requestPolicy: 'cache-and-network',
  });
  useEffect(() => {
    if (!isConnected || !address) return;
    const t = setInterval(() => refetch({ requestPolicy: 'network-only' }), 15_000);
    return () => clearInterval(t);
  }, [isConnected, address, refetch]);

  const rows = useMemo(() => data?.activity ?? [], [data?.activity]);

  // Load the persisted last-read block whenever the wallet flips.
  useEffect(() => {
    if (!address) { setLastReadBlock(0); return; }
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(`echo.bell.lastRead.${address.toLowerCase()}`) : null;
    setLastReadBlock(raw ? Number(raw) || 0 : 0);
  }, [address]);

  const maxBlock = rows.length > 0 ? Math.max(...rows.map((r) => r.blockNumber)) : 0;
  const unreadPendingCount = rows.filter((r) => r.state === 'PENDING' && r.blockNumber > lastReadBlock).length;

  const markAllRead = useCallback(() => {
    if (!address || maxBlock === 0) return;
    setLastReadBlock(maxBlock);
    try { window.localStorage.setItem(`echo.bell.lastRead.${address.toLowerCase()}`, String(maxBlock)); } catch { /* private mode */ }
  }, [address, maxBlock]);

  // Auto-mark on open if the user is actively looking — keeps the count honest. Pending status
  // is independent and still amber-dot in the row, so they can still see what's actionable.
  useEffect(() => {
    if (open && unreadPendingCount > 0) {
      // Slight delay so the badge "snap" reads as a deliberate ack, not a glitch.
      const t = setTimeout(markAllRead, 600);
      return () => clearTimeout(t);
    }
  }, [open, unreadPendingCount, markAllRead]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!isConnected) return null;
  const now = Math.floor(Date.now() / 1000);
  const totalPending = rows.filter((r) => r.state === 'PENDING').length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-full text-white/50 hover:bg-white/[0.06] hover:text-white transition"
        aria-label="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {unreadPendingCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadPendingCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-white/10 bg-[#0d2d4a] shadow-2xl z-20 overflow-hidden flex flex-col max-h-96">
          <div className="px-4 py-2.5 border-b border-white/[0.08] shrink-0 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">Activity</span>
            <div className="flex items-center gap-2">
              {totalPending > 0 && (
                <span className="text-[10px] font-medium text-warning">{totalPending} pending</span>
              )}
              {rows.length > 0 && (
                <button
                  onClick={markAllRead}
                  disabled={unreadPendingCount === 0 && lastReadBlock >= maxBlock}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-white/50 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Mark all as read"
                >
                  <Check className="w-3 h-3" /> Mark read
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-white/40 text-center">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-white/[0.08]">
                {rows.map((r) => {
                  const href = marketHref(r, address);
                  const isUnread = r.blockNumber > lastReadBlock;
                  const isPending = r.state === 'PENDING';
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm flex items-center gap-1.5 ${isUnread ? 'font-semibold text-white' : 'font-medium text-white/60'}`}>
                          {isPending && <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />}
                          {!isPending && isUnread && <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shrink-0" />}
                          {eventLabel(r.eventName)}
                        </span>
                        <span className="text-xs text-white/40 shrink-0">{timeAgo(r.createdAt, now)}</span>
                      </div>
                      <div className="text-xs text-white/50 font-mono mt-0.5 pr-28 truncate">
                        {r.marketId !== null && `#${r.marketId} `}{summarizeArgs(r.args)}
                      </div>
                    </>
                  );
                  return (
                    <li key={r.id} className={`relative ${isUnread && isPending ? 'bg-warning/5' : ''}`}>
                      {href ? (
                        <Link href={href} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-white/[0.04]">{body}</Link>
                      ) : (
                        <div className="px-4 py-2.5">{body}</div>
                      )}
                      {/* Tx link sits outside the row Link to avoid a nested anchor. */}
                      {r.txHash && (
                        <a
                          href={txLink(r.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute bottom-2.5 right-4 inline-flex items-center gap-1 text-xs text-white/40 hover:text-white"
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
          <Link
            href="/activity"
            onClick={() => setOpen(false)}
            className="shrink-0 border-t border-white/[0.08] px-4 py-2.5 text-center text-sm font-medium text-teal-400 hover:bg-white/[0.04]"
          >
            View all activity
          </Link>
        </div>
      )}
    </div>
  );
}
