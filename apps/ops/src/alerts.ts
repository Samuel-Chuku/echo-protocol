import { formatUnits } from 'viem';
import { config } from './config.js';
import { publicClient, ownerAccount } from './chain.js';
import { sql, indexerCursor } from './db.js';

export type AlertLevel = 'ok' | 'warn' | 'critical';
export interface Alert {
  level: AlertLevel;
  title: string;
  detail: string;
}

// Thresholds — tune as the protocol grows.
const LAG_WARN = 50; // blocks behind head
const LAG_CRIT = 500;
const BALANCE_WARN_USDC = 1; // deployer gas (USDC) running low
const BALANCE_CRIT_USDC = 0.2;
const DISPUTE_STALE_SECS = 24 * 3600; // open dispute with no resolution
const GHOST_SOON_SECS = 3600; // ghost deadline within the hour

/** Compute the operator health signals shown as the Overview alert banner. */
export async function alerts(): Promise<Alert[]> {
  const out: Alert[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Chain reachable + indexer lag
  let head: number | null = null;
  try {
    head = Number(await publicClient.getBlockNumber());
  } catch {
    out.push({ level: 'critical', title: 'RPC unreachable', detail: config.rpcUrl });
  }
  const cursor = await indexerCursor();
  if (head != null && cursor != null) {
    const lag = head - cursor;
    if (lag >= LAG_CRIT) out.push({ level: 'critical', title: 'Indexer far behind', detail: `${lag} blocks behind head` });
    else if (lag >= LAG_WARN) out.push({ level: 'warn', title: 'Indexer lagging', detail: `${lag} blocks behind head` });
  } else if (cursor == null) {
    out.push({ level: 'warn', title: 'Indexer not started', detail: 'no cursor row yet' });
  }

  // Deployer gas balance (only meaningful when a key is loaded)
  if (ownerAccount) {
    try {
      const bal = Number(formatUnits(await publicClient.getBalance({ address: ownerAccount.address }), 6));
      if (bal <= BALANCE_CRIT_USDC) out.push({ level: 'critical', title: 'Deployer almost out of gas', detail: `${bal.toFixed(4)} USDC` });
      else if (bal <= BALANCE_WARN_USDC) out.push({ level: 'warn', title: 'Deployer gas low', detail: `${bal.toFixed(2)} USDC` });
    } catch {
      /* balance read failed — RPC alert already covers it */
    }
  }

  // Stale open disputes (status 0 = open, 1 = countered)
  try {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM disputes WHERE status = 0 AND created_at < ${now - DISPUTE_STALE_SECS}
    `;
    if (Number(row?.n ?? 0) > 0) out.push({ level: 'warn', title: 'Stale disputes', detail: `${row.n} open >24h — may need a juror` });
  } catch {
    /* disputes table may be empty/missing */
  }

  // Ghost deadlines approaching for active markets
  try {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM markets
      WHERE status = 'active' AND ghost_deadline IS NOT NULL
        AND ghost_deadline > ${now} AND ghost_deadline < ${now + GHOST_SOON_SECS}
    `;
    if (Number(row?.n ?? 0) > 0) out.push({ level: 'warn', title: 'Ghost deadlines soon', detail: `${row.n} market(s) within the hour` });
  } catch {
    /* markets table may be empty */
  }

  if (out.length === 0) out.push({ level: 'ok', title: 'All clear', detail: 'no active alerts' });
  return out;
}
